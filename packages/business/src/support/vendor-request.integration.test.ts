import type { AuthContext } from "@sangfor/auth";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { applyU043RlsGrants } from "../crm/u043-grant.fixture";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const EVIDENCE_ROOT = join(REPO_ROOT, ".omo/evidence/sangfor-system-refactor-2026-07-15/U049/attempt-1");
const POSTGRES_EVIDENCE = join(EVIDENCE_ROOT, "postgres-integration");

const SALES_MGR: AuthContext = {
  userId: "u049-sales", sessionId: "u049-s1", tenantId: "u049-tenant",
  companyId: "u049-company", projectId: "u049-project",
  businessRole: "sales_manager", permissions: ["vendor_request.create" as any], product: "portal",
};

let admin: PrismaClient;
let migrationAdmin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;
let vendorRequestService: typeof import("./vendor-request");

describe.runIf(integration)("U049 Vendor Request Integration", () => {
  beforeAll(async () => {
    mkdirSync(POSTGRES_EVIDENCE, { recursive: true });
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    let resolveReady: ((ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => void) | undefined;
    const ready = new Promise<{ databaseUrl: string; migrationDatabaseUrl: string }>((r) => { resolveReady = r; });
    const held = new Promise<void>((r) => { releaseLifecycle = r; });

    lifecycle = withIsolatedPostgres(
      { runId: `u049-vreq-${Date.now().toString(36)}`, ownerUnit: "U049", purpose: "vendor-request-integration", evidenceDir: POSTGRES_EVIDENCE, imageDigest: IMAGE_DIGEST, migrate: true, applicationRoleMode: "required" },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => { resolveReady?.(ctx); await held; },
    );

    const scratch = await ready;
    process.env.DATABASE_URL = scratch.migrationDatabaseUrl;
    process.env.SANGFOR_APP_DATABASE_URL = scratch.databaseUrl;

    migrationAdmin = new PrismaClient({ datasources: { db: { url: scratch.migrationDatabaseUrl } } });
    admin = new PrismaClient({ datasources: { db: { url: scratch.databaseUrl } } });

    await applyU043RlsGrants(migrationAdmin);

    const tables = [
      "discount_requests", "vendor_requests", "vendor_request_events", "demo_licenses",
      "opportunities", "quotes", "audit_logs",
    ];
    for (const t of tables) {
      try {
        const [{ regclass }] = await migrationAdmin.$queryRawUnsafe<{ regclass: string | null }[]>(`SELECT to_regclass('public."${t}"')::text as regclass;`);
        if (regclass) await migrationAdmin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${t}" TO sangfor_app;`);
      } catch { /* skip */ }
    }

    await migrationAdmin.tenant.create({ data: { id: "u049-tenant", slug: "u049-tenant", name: "U049", status: "active" } });
    await migrationAdmin.company.create({ data: { id: "u049-company", tenantId: "u049-tenant", slug: "u049-company", name: "U049 Co" } });
    await migrationAdmin.project.create({ data: { id: "u049-project", companyId: "u049-company", slug: "u049-project", name: "U049 Proj" } });
    await migrationAdmin.customer.create({
      data: { id: "u049-customer", projectId: "u049-project", name: "U049 Customer" },
    });

    await migrationAdmin.user.create({ data: { id: "u049-sales", email: "u049-sales@sangfor.local", name: "u049-sales" } });
    await migrationAdmin.userCompanyRole.create({ data: { id: "ucr-u049-sales", companyId: "u049-company", userId: "u049-sales", role: "sales_manager", status: "active", validFrom: new Date(Date.now() - 3600000) } });

    const opp = await migrationAdmin.opportunity.create({
      data: {
        id: "u049-opp1",
        projectId: "u049-project",
        customerId: "u049-customer",
        title: "U049 Opp",
        stage: "PROPOSAL",
      },
    });
    (globalThis as any).__u049OppId = opp.id;

    const quote = await migrationAdmin.quote.create({
      data: {
        id: "u049-quote1", companyId: "u049-company", opportunityId: opp.id, version: 1,
        totalRevenue: 20000, totalCost: 10000, marginPct: 50, createdBy: "ucr-u049-sales",
      },
    });
    (globalThis as any).__u049QuoteId = quote.id;

    vi.resetModules();
    vendorRequestService = await import("./vendor-request");
  }, 180000);

  afterAll(async () => {
    if (admin) await admin.$disconnect();
    if (migrationAdmin) await migrationAdmin.$disconnect();
    delete process.env.SANGFOR_APP_DATABASE_URL;
    if (releaseLifecycle) releaseLifecycle();
    if (lifecycle) await lifecycle;
    if (previousDatabaseUrl) process.env.DATABASE_URL = previousDatabaseUrl;
    else delete process.env.DATABASE_URL;
  });

  it("proves U036 immutable event triggers exist in pg_trigger", async () => {
    const triggers = await migrationAdmin.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT tgname FROM pg_trigger WHERE tgname IN ('vendor_request_events_immutable_update_trg', 'vendor_request_events_immutable_delete_trg');`
    );
    expect(triggers.length).toBe(2);
  });

  it("creates vendor request and progresses through tagged events to approved outcome", async () => {
    const oppId = (globalThis as any).__u049OppId;

    const createRes = await vendorRequestService.createVendorRequest({
      authContext: SALES_MGR,
      opportunityId: oppId,
      quoteId: (globalThis as any).__u049QuoteId,
      requestType: "special_discount",
      idempotencyKey: "u049-vreq-k1",
    });

    expect(createRes.requestId).toBeTruthy();
    expect(createRes.status).toBe("ready_for_manual_submission");
    expect(createRes.revision).toBe(0);

    const submitRes = await vendorRequestService.recordVendorRequestEvent({
      authContext: SALES_MGR,
      requestId: createRes.requestId,
      event: "record_manual_submission",
      expectedRevision: 0,
      externalReference: "EXT-DISC-9001",
      idempotencyKey: "u049-vreq-k2",
    });

    expect(submitRes.status).toBe("manually_submitted");
    expect(submitRes.revision).toBe(1);

    const waitRes = await vendorRequestService.recordVendorRequestEvent({
      authContext: SALES_MGR,
      requestId: createRes.requestId,
      event: "mark_waiting_vendor",
      expectedRevision: 1,
      idempotencyKey: "u049-vreq-k3",
    });

    expect(waitRes.status).toBe("waiting_vendor");
    expect(waitRes.revision).toBe(2);

    const outcomeRes = await vendorRequestService.recordVendorRequestOutcome({
      authContext: SALES_MGR,
      requestId: createRes.requestId,
      outcome: "approved",
      expectedRevision: 2,
      idempotencyKey: "u049-vreq-k4",
    });

    expect(outcomeRes.status).toBe("approved");
    expect(outcomeRes.revision).toBe(3);

    writeFileSync(join(POSTGRES_EVIDENCE, "vendor-request-lifecycle-receipt.json"), JSON.stringify(outcomeRes, null, 2));
  });
});
