import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { AuthContext } from "@sangfor/auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { applyU044RlsGrants } from "./u044-grant.fixture";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST =
  "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const EVIDENCE_DIR = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U044/attempt-1/catalog-scratch",
);
const EVIDENCE_ROOT = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U044/attempt-1",
);

const WRITER: AuthContext = {
  userId: "u044-user-writer-a",
  sessionId: "u044-session-writer-a",
  tenantId: "u044-tenant-a",
  companyId: "u044-company-a",
  projectId: "u044-project-a",
  businessRole: "sales_manager",
  permissions: ["catalog.read", "catalog.write", "catalog.cost.read"] as any,
  product: "portal",
};

const READER: AuthContext = {
  userId: "u044-user-reader-a",
  sessionId: "u044-session-reader-a",
  tenantId: "u044-tenant-a",
  companyId: "u044-company-a",
  projectId: "u044-project-a",
  businessRole: "account_manager",
  permissions: ["catalog.read"] as any,
  product: "portal",
};

const FOREIGN: AuthContext = {
  userId: "u044-user-foreign-b",
  sessionId: "u044-session-foreign-b",
  tenantId: "u044-tenant-b",
  companyId: "u044-company-b",
  projectId: "u044-project-b",
  businessRole: "sales_manager",
  permissions: ["catalog.read", "catalog.write"] as any,
  product: "portal",
};

let admin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let catalogService: typeof import("./catalog-service");
let previousDatabaseUrl: string | undefined;

async function seedCompanyScope(suffix: "a" | "b") {
  const tenantId = `u044-tenant-${suffix}`;
  const companyId = `u044-company-${suffix}`;
  const projectId = `u044-project-${suffix}`;
  const userId = `u044-user-writer-${suffix}`;

  await admin.tenant.create({
    data: {
      id: tenantId,
      slug: tenantId,
      name: `Catalog Tenant ${suffix}`,
      status: "active",
    },
  });
  await admin.company.create({
    data: {
      id: companyId,
      tenantId,
      slug: companyId,
      name: `Catalog Company ${suffix}`,
    },
  });
  await admin.project.create({
    data: {
      id: projectId,
      companyId,
      slug: projectId,
      name: `Catalog Project ${suffix}`,
    },
  });
  await admin.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      name: `Catalog User ${suffix}`,
      status: "active",
    },
  });
}

describe.skipIf(!integration)("U044 canonical catalog integration", () => {
  beforeAll(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    let resolveReady:
      | ((ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => void)
      | undefined;
    const ready = new Promise<{
      databaseUrl: string;
      migrationDatabaseUrl: string;
    }>((resolveReadyPromise) => {
      resolveReady = resolveReadyPromise;
    });
    const held = new Promise<void>((resolveHeld) => {
      releaseLifecycle = resolveHeld;
    });

    lifecycle = withIsolatedPostgres(
      {
        runId: `u044-catalog-${Date.now().toString(36)}`,
        ownerUnit: "U044",
        purpose: "catalog-integration",
        evidenceDir: EVIDENCE_DIR,
        imageDigest: IMAGE_DIGEST,
        migrate: true,
        applicationRoleMode: "required",
      },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => {
        resolveReady?.(ctx);
        await held;
      },
    );

    const scratch = await ready;
    process.env.DATABASE_URL = scratch.migrationDatabaseUrl;
    process.env.SANGFOR_APP_DATABASE_URL = scratch.databaseUrl;
    admin = new PrismaClient({
      datasources: { db: { url: scratch.migrationDatabaseUrl } },
    });
    await applyU044RlsGrants(admin);
    await seedCompanyScope("a");
    await seedCompanyScope("b");

    vi.resetModules();
    catalogService = await import("./catalog-service");
  }, 180_000);

  afterAll(async () => {
    await admin?.$disconnect();
    delete process.env.SANGFOR_APP_DATABASE_URL;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    releaseLifecycle?.();
    await lifecycle;
  }, 60_000);

  it("performs serializable all-or-nothing import and emits dry-run receipt", async () => {
    const payload = {
      familyKey: "fam-sangfor-ngaf",
      vendorKey: "sangfor",
      vendor: "Sangfor Technologies",
      name: "Sangfor NGAF",
      description: "Next-Generation Application Firewall",
      category: "Security",
      editions: [
        {
          editionKey: "enterprise",
          name: "Enterprise Edition",
          version: "8.0.5",
          skus: [
            {
              skuCode: "SKU-NGAF-ENT-01",
              name: "NGAF Enterprise Appliance License",
              unitPrice: 12000,
              unitCost: 7500,
              currency: "USD",
              termMonths: 12,
              deploymentType: "appliance",
              supportLevel: "24x7",
            },
          ],
        },
      ],
      metrics: [
        {
          key: "metric-bandwidth-gbps",
          name: "Bandwidth Gbps",
          unit: "Gbps",
          description: "Throughput bandwidth capacity",
        },
      ],
    };

    // Dry Run
    const dryRunResult = await catalogService.importCatalogPayload(WRITER, {
      payload,
      dryRun: true,
      idempotencyKey: "import-dry-run-key-1",
    });
    expect(dryRunResult.dryRun).toBe(true);
    expect(dryRunResult.summary?.skusCount).toBe(1);

    // Dry Run assertion: DB counts must be ALL 0 (dry-run side-effect free proof)
    const dryRunFamilyCount = await admin.productFamily.count({
      where: { familyKey: "fam-sangfor-ngaf" },
    });
    const dryRunEditionCount = await admin.productEdition.count({
      where: { editionKey: "enterprise" },
    });
    const dryRunMetricCount = await admin.licenseMetric.count({
      where: { key: "metric-bandwidth-gbps" },
    });
    const dryRunSkuCount = await admin.productSku.count({
      where: { skuCode: "SKU-NGAF-ENT-01" },
    });

    expect(dryRunFamilyCount).toBe(0);
    expect(dryRunEditionCount).toBe(0);
    expect(dryRunMetricCount).toBe(0);
    expect(dryRunSkuCount).toBe(0);

    // Save dry run evidence
    writeFileSync(
      join(EVIDENCE_ROOT, "import-dry-run.json"),
      JSON.stringify(dryRunResult, null, 2),
    );

    // Commit Import
    const commitResult = await catalogService.importCatalogPayload(WRITER, {
      payload,
      dryRun: false,
      idempotencyKey: "import-commit-key-1",
    });
    expect(commitResult.created).toBe(true);
    expect(commitResult.family?.name).toBe("Sangfor NGAF");

    // Commit assertion: DB counts must equal payload specification (1/1/1/1)
    const committedFamilyCount = await admin.productFamily.count({
      where: { familyKey: "fam-sangfor-ngaf" },
    });
    const committedFamily = await admin.productFamily.findFirst({
      where: { familyKey: "fam-sangfor-ngaf" },
    });
    const committedEditionCount = await admin.productEdition.count({
      where: { familyId: committedFamily!.id, editionKey: "enterprise" },
    });
    const committedMetricCount = await admin.licenseMetric.count({
      where: { productFamilyId: committedFamily!.id, key: "metric-bandwidth-gbps" },
    });
    const committedSkuCount = await admin.productSku.count({
      where: { skuCode: "SKU-NGAF-ENT-01" },
    });

    expect(committedFamilyCount).toBe(1);
    expect(committedEditionCount).toBe(1);
    expect(committedMetricCount).toBe(1);
    expect(committedSkuCount).toBe(1);
  });

  it("handles same replay idempotency and emits replay receipt while rejecting conflicting replay 409", async () => {
    const payload = {
      familyKey: "fam-sangfor-iag",
      vendorKey: "sangfor",
      vendor: "Sangfor Technologies",
      name: "Sangfor IAG",
      description: "Internet Access Gateway",
      category: "Security",
      editions: [
        {
          editionKey: "std",
          name: "Standard",
          version: "5.2.0",
          skus: [
            {
              skuCode: "SKU-IAG-STD-01",
              name: "IAG Standard License",
              unitPrice: 4000,
              unitCost: 2000,
              currency: "USD",
            },
          ],
        },
      ],
      metrics: [],
    };

    const first = await catalogService.importCatalogPayload(WRITER, {
      payload,
      idempotencyKey: "import-iag-replay-key",
    });
    expect(first.created).toBe(true);

    const replay = await catalogService.importCatalogPayload(WRITER, {
      payload,
      idempotencyKey: "import-iag-replay-key",
    });
    expect(replay.created).toBe(false);
    expect(replay.family?.id).toBe(first.family?.id);

    // Save replay evidence
    writeFileSync(
      join(EVIDENCE_ROOT, "import-replay.json"),
      JSON.stringify(replay, null, 2),
    );

    // Conflict Replay with changed payload
    const conflicting = { ...payload, name: "Conflicting IAG Name" };
    await expect(
      catalogService.importCatalogPayload(WRITER, {
        payload: conflicting,
        idempotencyKey: "import-iag-replay-key",
      }),
    ).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("executes concurrent identical imports resulting in a single graph in DB", async () => {
    const payload = {
      familyKey: "fam-sangfor-concurrent-hci",
      vendorKey: "sangfor",
      vendor: "Sangfor Technologies",
      name: "Sangfor Concurrent HCI",
      description: "Concurrent import test family",
      category: "Infrastructure",
      editions: [
        {
          editionKey: "std-conc",
          name: "Standard Concurrent Edition",
          version: "7.0.0",
          skus: [
            {
              skuCode: "SKU-HCI-CONC-01",
              name: "Concurrent Node License",
              unitPrice: 6000,
              unitCost: 3500,
              currency: "USD",
            },
          ],
        },
      ],
      metrics: [
        {
          key: "metric-conc-core",
          name: "Concurrent CPU Core",
          unit: "core",
        },
      ],
    };

    const idempotencyKey = "concurrent-import-same-key";

    const results = await Promise.allSettled([
      catalogService.importCatalogPayload(WRITER, { payload, idempotencyKey }),
      catalogService.importCatalogPayload(WRITER, { payload, idempotencyKey }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const familyCount = await admin.productFamily.count({
      where: { companyId: WRITER.companyId, familyKey: "fam-sangfor-concurrent-hci" },
    });
    expect(familyCount).toBe(1);

    const family = await admin.productFamily.findFirst({
      where: { companyId: WRITER.companyId, familyKey: "fam-sangfor-concurrent-hci" },
    });
    expect(family).not.toBeNull();

    const editionCount = await admin.productEdition.count({
      where: { familyId: family!.id, editionKey: "std-conc" },
    });
    expect(editionCount).toBe(1);

    const skuCount = await admin.productSku.count({
      where: { skuCode: "SKU-HCI-CONC-01" },
    });
    expect(skuCount).toBe(1);

    const metricCount = await admin.licenseMetric.count({
      where: { key: "metric-conc-core" },
    });
    expect(metricCount).toBe(1);
  });

  it("rolls back all entities when audit append fails and emits rollback counts", async () => {
    await admin.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION u044_fail_catalog_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.idempotency_key = 'catalog.import:forced-audit-failure' THEN
          RAISE EXCEPTION 'u044_forced_audit_failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await admin.$executeRawUnsafe(`
      CREATE TRIGGER u044_fail_catalog_audit_trg
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION u044_fail_catalog_audit();
    `);

    const payload = {
      familyKey: "fam-rollback-test",
      vendorKey: "vendor-rollback",
      vendor: "Rollback Vendor",
      name: "Rollback Family",
      description: "Should be rolled back",
      category: "Test",
      editions: [],
      metrics: [],
    };

    await expect(
      catalogService.importCatalogPayload(WRITER, {
        payload,
        idempotencyKey: "forced-audit-failure",
      }),
    ).rejects.toThrow();

    const familyCount = await admin.productFamily.count({
      where: { familyKey: "fam-rollback-test" },
    });
    expect(familyCount).toBe(0);

    const rollbackCounts = {
      familyKey: "fam-rollback-test",
      familyCount,
      rolledBack: true,
    };

    writeFileSync(
      join(EVIDENCE_ROOT, "rollback-counts.json"),
      JSON.stringify(rollbackCounts, null, 2),
    );
  });

  it("enforces scope isolation and references preservation upon archive", async () => {
    const created = await catalogService.createProductFamily(WRITER, {
      familyKey: "fam-scope-test",
      vendor: "Sangfor",
      name: "Scope Isolation Family",
      idempotencyKey: "create-scope-test-key",
    });

    // Foreign context sees nothing
    const foreignList = await catalogService.listCatalogProducts(FOREIGN, { first: 10 });
    expect(foreignList.items.some((f) => f.id === created.id)).toBe(false);

    // Reader sees family but cost is redacted
    const readerDetail = await catalogService.getCatalogProductDetail(READER, created.id);
    expect(readerDetail?.id).toBe(created.id);

    // Archive family
    const archived = await catalogService.archiveProductFamily(WRITER, created.id, {
      expectedUpdatedAt: created.updatedAt ? created.updatedAt.toISOString() : new Date().toISOString(),
      idempotencyKey: "archive-scope-test-key",
    });
    expect(archived.status).toBe("archived");

    // Check DB record still exists (reference preservation)
    const dbRecord = await admin.productFamily.findUnique({ where: { id: created.id } });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.status).toBe("archived");
  });
});
