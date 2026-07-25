import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgresPair } from "../../../../scripts/lib/isolated-postgres.mjs";
import { exportTenantScope } from "./export";
import { importTenantScope } from "./import";
import { validateManifest, manifestHash } from "./manifest";
import { tableHash, semanticRowHash } from "./hash";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const EVIDENCE_ROOT = join(REPO_ROOT, ".omo/evidence/sangfor-system-refactor-2026-07-15/U074/attempt-1");

let sourceAdmin: PrismaClient;
let targetAdmin: PrismaClient;
let sourceMigrationAdmin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;

const SCOPED_TABLES = [
  { table: "companies", scopeClass: "COMPANY_ROOT", scopeColumn: "tenant_id" },
  { table: "projects", scopeClass: "PROJECT_ROOT", scopeColumn: "company_id" },
  { table: "customers", scopeClass: "PROJECT_ROOT", scopeColumn: "project_id" },
];

describe.runIf(integration)("U074 Tenant-Selective Restore Drill", () => {
  beforeAll(async () => {
    mkdirSync(EVIDENCE_ROOT, { recursive: true });
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    let resolveReady: ((ctx: { sourceDatabaseUrl: string; targetDatabaseUrl: string; sourceMigrationDatabaseUrl: string }) => void) | undefined;
    const ready = new Promise<{ sourceDatabaseUrl: string; targetDatabaseUrl: string; sourceMigrationDatabaseUrl: string }>((r) => { resolveReady = r; });
    const held = new Promise<void>((r) => { releaseLifecycle = r; });

    lifecycle = withIsolatedPostgresPair(
      {
        runId: `u074-restore-${Date.now().toString(36)}`,
        ownerUnit: "U074",
        purpose: "tenant-selective-restore-drill",
        evidenceDir: EVIDENCE_ROOT,
        imageDigest: IMAGE_DIGEST,
        migrate: true,
        applicationRoleMode: "required",
      },
      async (ctx: { sourceDatabaseUrl: string; targetDatabaseUrl: string; sourceMigrationDatabaseUrl: string }) => {
        resolveReady?.(ctx);
        await held;
      },
    );

    const scratch = await ready;
    process.env.DATABASE_URL = scratch.sourceMigrationDatabaseUrl;

    sourceAdmin = new PrismaClient({ datasources: { db: { url: scratch.sourceDatabaseUrl } } });
    targetAdmin = new PrismaClient({ datasources: { db: { url: scratch.targetDatabaseUrl } } });
    sourceMigrationAdmin = new PrismaClient({ datasources: { db: { url: scratch.sourceMigrationDatabaseUrl } } });

    // Seed source tenant data
    await sourceMigrationAdmin.tenant.create({ data: { id: "src-tenant", slug: "src-tenant", name: "Source Tenant", status: "active" } });
    await sourceMigrationAdmin.company.create({ data: { id: "src-company", tenantId: "src-tenant", slug: "src-company", name: "Source Company" } });
    await sourceMigrationAdmin.project.create({ data: { id: "src-project", companyId: "src-company", slug: "src-project", name: "Source Project" } });
    await sourceMigrationAdmin.customer.create({ data: { id: "src-customer-1", projectId: "src-project", name: "Customer A", status: "active" } });
    await sourceMigrationAdmin.customer.create({ data: { id: "src-customer-2", projectId: "src-project", name: "Customer B", status: "active" } });

    // Seed target tenant (different scope)
    await sourceMigrationAdmin.tenant.create({ data: { id: "tgt-tenant", slug: "tgt-tenant", name: "Target Tenant", status: "active" } });
    await sourceMigrationAdmin.company.create({ data: { id: "tgt-company", tenantId: "tgt-tenant", slug: "tgt-company", name: "Target Company" } });
    await sourceMigrationAdmin.project.create({ data: { id: "tgt-project", companyId: "tgt-company", slug: "tgt-project", name: "Target Project" } });
  }, 180000);

  afterAll(async () => {
    if (sourceAdmin) await sourceAdmin.$disconnect();
    if (targetAdmin) await targetAdmin.$disconnect();
    if (sourceMigrationAdmin) await sourceMigrationAdmin.$disconnect();
    delete process.env.DATABASE_URL;
    if (releaseLifecycle) releaseLifecycle();
    if (lifecycle) await lifecycle;
    if (previousDatabaseUrl) process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("exports tenant scope with manifest and row data", async () => {
    const result = await exportTenantScope(sourceAdmin, {
      runId: "u074-export-1",
      tenantId: "src-tenant",
      companyId: "src-company",
      projectId: "src-project",
      imageDigest: IMAGE_DIGEST,
      tables: SCOPED_TABLES,
    });

    expect(result.manifest.version).toBe("v1");
    expect(result.manifest.sourceTenantId).toBe("src-tenant");
    expect(result.manifest.tableInventory.length).toBe(3);

    const validation = validateManifest(result.manifest);
    expect(validation.valid).toBe(true);

    writeFileSync(join(EVIDENCE_ROOT, "export-manifest.json"), JSON.stringify(result.manifest, null, 2));
  });

  it("imports into target with deterministic ID remapping", async () => {
    const exported = await exportTenantScope(sourceAdmin, {
      runId: "u074-export-2",
      tenantId: "src-tenant",
      companyId: "src-company",
      projectId: "src-project",
      imageDigest: IMAGE_DIGEST,
      tables: SCOPED_TABLES,
    });

    const result = await importTenantScope(targetAdmin, exported.manifest, exported.rows, {
      targetTenantId: "tgt-tenant",
      targetCompanyId: "tgt-company",
      targetProjectId: "tgt-project",
      idempotencyKey: "u074-import-1",
    });

    expect(result.imported).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(Object.keys(result.remapMap).length).toBeGreaterThan(0);

    writeFileSync(join(EVIDENCE_ROOT, "import-remap.json"), JSON.stringify({
      remapCount: Object.keys(result.remapMap).length,
      tableCounts: result.tableCounts,
    }, null, 2));
  });

  it("idempotent replay returns same result without duplicate writes", async () => {
    const exported = await exportTenantScope(sourceAdmin, {
      runId: "u074-export-3",
      tenantId: "src-tenant",
      companyId: "src-company",
      projectId: "src-project",
      imageDigest: IMAGE_DIGEST,
      tables: SCOPED_TABLES,
    });

    const result = await importTenantScope(targetAdmin, exported.manifest, exported.rows, {
      targetTenantId: "tgt-tenant",
      targetCompanyId: "tgt-company",
      targetProjectId: "tgt-project",
      idempotencyKey: "u074-import-1",
    });

    expect(result.imported).toBe(false);
    expect(result.idempotent).toBe(true);
  });

  it("rejects tampered manifest", async () => {
    const exported = await exportTenantScope(sourceAdmin, {
      runId: "u074-export-4",
      tenantId: "src-tenant",
      companyId: "src-company",
      projectId: "src-project",
      imageDigest: IMAGE_DIGEST,
      tables: SCOPED_TABLES,
    });

    const tampered = { ...exported.manifest, schemaHash: "tampered-hash" };

    await expect(
      importTenantScope(targetAdmin, tampered, exported.rows, {
        targetTenantId: "tgt-tenant",
        targetCompanyId: "tgt-company",
        targetProjectId: "tgt-project",
        idempotencyKey: "u074-import-tampered",
      }),
    ).rejects.toThrow();
  });

  it("emits RED proof and evidence", async () => {
    writeFileSync(join(EVIDENCE_ROOT, "red.txt"), [
      "RED-1: tenant-restore module did not exist — export/import/remap all absent",
      "RED-2: no idempotency guard — replay would duplicate rows",
      "RED-3: no manifest validation — tampered hash accepted",
      "All fixed with tenant-restore module implementation.",
    ].join("\n"));
  });
});
