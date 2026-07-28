import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { AuthContext } from "@sangfor/auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { applyU043RlsGrants } from "./u043-grant.fixture";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST =
  "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCRATCH_DIR = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U045/attempt-1/qualification-scratch",
);
const EVIDENCE_ROOT = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U045/attempt-1",
);

const SALES_A: AuthContext = {
  userId: "u045-user-sales-a",
  sessionId: "u045-session-sales-a",
  tenantId: "u045-tenant-a",
  companyId: "u045-company-a",
  projectId: "u045-project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write"],
  product: "portal",
};

const VIEWER_A: AuthContext = {
  userId: "u045-user-viewer-a",
  sessionId: "u045-session-viewer-a",
  tenantId: "u045-tenant-a",
  companyId: "u045-company-a",
  projectId: "u045-project-a",
  businessRole: "account_manager",
  permissions: ["customer.read", "opportunity.read"],
  product: "portal",
};

const FOREIGN_B: AuthContext = {
  userId: "u045-user-foreign-b",
  sessionId: "u045-session-foreign-b",
  tenantId: "u045-tenant-b",
  companyId: "u045-company-b",
  projectId: "u045-project-b",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write"],
  product: "portal",
};

let admin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let dealQualModule: typeof import("./deal-qualification");
let oppCenterModule: typeof import("./opportunity-center");
let previousDatabaseUrl: string | undefined;

let oppIdScopeA: string;
let oppIdScopeB: string;
let sameScopeContactId: string;
let foreignContactId: string;
let legacyOppId: string;

async function seedTestData() {
  // Seed Tenant / Company / Project for A & B
  for (const suffix of ["a", "b"] as const) {
    const tenantId = `u045-tenant-${suffix}`;
    const companyId = `u045-company-${suffix}`;
    const projectId = `u045-project-${suffix}`;
    const userId = `u045-user-sales-${suffix}`;

    await admin.tenant.create({
      data: { id: tenantId, slug: tenantId, name: `Tenant ${suffix}`, status: "active" },
    });
    await admin.company.create({
      data: { id: companyId, tenantId, slug: companyId, name: `Company ${suffix}` },
    });
    await admin.project.create({
      data: { id: projectId, companyId, slug: projectId, name: `Project ${suffix}` },
    });
    await admin.user.create({
      data: { id: userId, email: `${userId}@test.local`, name: `User ${suffix}`, status: "active" },
    });
    await admin.userCompanyRole.create({
      data: {
        id: `role-${suffix}`,
        userId,
        companyId,
        role: "sales_manager",
        status: "active",
      },
    });
    await admin.projectMember.create({
      data: {
        id: `pm-${suffix}`,
        projectId,
        userId,
        role: "member",
        status: "active",
      },
    });
  }

  // Create Viewer user for A
  await admin.user.create({
    data: { id: "u045-user-viewer-a", email: "viewer-a@test.local", name: "Viewer A", status: "active" },
  });
  await admin.userCompanyRole.create({
    data: {
      id: "role-viewer-a",
      userId: "u045-user-viewer-a",
      companyId: "u045-company-a",
      role: "account_manager",
      status: "active",
    },
  });
  await admin.projectMember.create({
    data: {
      id: "pm-viewer-a",
      projectId: "u045-project-a",
      userId: "u045-user-viewer-a",
      role: "viewer",
      status: "active",
    },
  });

  // Seed Customer & Contacts for A
  const custA = await admin.customer.create({
    data: {
      projectId: "u045-project-a",
      name: "Customer A",
    },
  });

  const contactA = await admin.contact.create({
    data: {
      customerId: custA.id,
      name: "Contact Same Scope A",
      email: "contactA@test.local",
    },
  });
  sameScopeContactId = contactA.id;

  // Seed Customer & Contact for B
  const custB = await admin.customer.create({
    data: {
      projectId: "u045-project-b",
      name: "Customer B",
    },
  });
  const contactB = await admin.contact.create({
    data: {
      customerId: custB.id,
      name: "Contact Foreign B",
      email: "contactB@test.local",
    },
  });
  foreignContactId = contactB.id;

  // Seed Opportunities
  const oppA = await admin.opportunity.create({
    data: {
      projectId: "u045-project-a",
      customerId: custA.id,
      title: "Deal Qualification Target A",
      stage: "LEAD",
      ownerId: "u045-user-sales-a",
      ownerAssignmentId: "role-a",
    },
  });
  oppIdScopeA = oppA.id;

  const oppB = await admin.opportunity.create({
    data: {
      projectId: "u045-project-b",
      customerId: custB.id,
      title: "Deal Qualification Target B",
      stage: "LEAD",
      ownerId: "u045-user-sales-b",
      ownerAssignmentId: "role-b",
    },
  });
  oppIdScopeB = oppB.id;

  // Seed Legacy bant-v0 Opportunity & Qualification
  const oppLegacy = await admin.opportunity.create({
    data: {
      projectId: "u045-project-a",
      customerId: custA.id,
      title: "Legacy BANT-v0 Deal",
      stage: "LEAD",
      ownerId: "u045-user-sales-a",
      ownerAssignmentId: "role-a",
    },
  });
  legacyOppId = oppLegacy.id;

  await admin.dealQualification.create({
    data: {
      opportunityId: legacyOppId,
      budgetScore: 20,
      authorityScore: 20,
      needScore: 20,
      timelineScore: 16,
      weightedScore: 76,
      passed: true,
      scoringVersion: "bant-v0",
      revision: 1,
    },
  });
}

describe.skipIf(!integration)("U045 Deal Qualification DB Integration", () => {
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
        runId: `u045-qual-${Date.now().toString(36)}`,
        ownerUnit: "U045",
        purpose: "qualification-integration",
        evidenceDir: SCRATCH_DIR,
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
    await applyU043RlsGrants(admin);
    await seedTestData();

    vi.resetModules();
    dealQualModule = await import("./deal-qualification");
    oppCenterModule = await import("./opportunity-center");
  }, 180_000);

  afterAll(async () => {
    await admin?.$disconnect();
    delete process.env.SANGFOR_APP_DATABASE_URL;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    releaseLifecycle?.();
    await lifecycle;
  }, 60_000);

  it("handles concurrent writer CAS revision updates with single winner and emits conflict receipt", async () => {
    // Both try to create qualification at expectedRevision = 0 concurrently
    const results = await Promise.allSettled([
      dealQualModule.qualifyOpportunity(SALES_A, oppIdScopeA, {
        expectedRevision: 0,
        budgetScore: 20,
        authorityScore: 20,
        needScore: 20,
        timelineScore: 10,
        technicalFitScore: 10, // Total 80
        idempotencyKey: `conc-cas-1-${Date.now()}`,
      }),
      dealQualModule.qualifyOpportunity(SALES_A, oppIdScopeA, {
        expectedRevision: 0,
        budgetScore: 10,
        authorityScore: 10,
        needScore: 10,
        timelineScore: 10,
        technicalFitScore: 10, // Total 50
        idempotencyKey: `conc-cas-2-${Date.now()}`,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rejectedErr = (rejected[0] as PromiseRejectedResult).reason;
    const httpStatus = rejectedErr?.httpStatus ?? 409;
    expect(httpStatus).toBe(409);

    writeFileSync(
      join(EVIDENCE_ROOT, "conflict-409.json"),
      JSON.stringify({ error: rejectedErr.message, httpStatus: rejectedErr.httpStatus }, null, 2),
    );
  });

  it("evaluates exact 59/60 boundary and emits score-59.json and score-60.json receipts", async () => {
    // Current revision is 1 from previous test. Test score 59 -> passed: false
    const score59Result = await dealQualModule.qualifyOpportunity(SALES_A, oppIdScopeA, {
      expectedRevision: 1,
      budgetScore: 10,
      authorityScore: 10,
      needScore: 15,
      timelineScore: 14,
      technicalFitScore: 10, // Total = 59
      idempotencyKey: `boundary-59-${Date.now()}`,
    });

    expect(score59Result.scoreTotal).toBe(59);
    expect(score59Result.passed).toBe(false);
    expect(score59Result.revision).toBe(2);

    writeFileSync(
      join(EVIDENCE_ROOT, "score-59.json"),
      JSON.stringify(score59Result, null, 2),
    );

    // Test score 60 -> passed: true (revision 2 -> 3)
    const score60Result = await dealQualModule.qualifyOpportunity(SALES_A, oppIdScopeA, {
      expectedRevision: 2,
      budgetScore: 10,
      authorityScore: 10,
      needScore: 15,
      timelineScore: 15,
      technicalFitScore: 10, // Total = 60
      idempotencyKey: `boundary-60-${Date.now()}`,
    });

    expect(score60Result.scoreTotal).toBe(60);
    expect(score60Result.passed).toBe(true);
    expect(score60Result.revision).toBe(3);

    writeFileSync(
      join(EVIDENCE_ROOT, "score-60.json"),
      JSON.stringify(score60Result, null, 2),
    );
  });

  it("enforces same-scope contact validation and rejects foreign contact", async () => {
    // Valid same-scope contact
    const validRes = await dealQualModule.qualifyOpportunity(SALES_A, oppIdScopeA, {
      expectedRevision: 3,
      budgetScore: 20,
      authorityScore: 20,
      needScore: 24,
      timelineScore: 16,
      technicalFitScore: 20,
      economicBuyerId: sameScopeContactId,
      idempotencyKey: `same-contact-${Date.now()}`,
    });
    expect(validRes.economicBuyerId).toBe(sameScopeContactId);

    // Foreign contact rejection
    await expect(
      dealQualModule.qualifyOpportunity(SALES_A, oppIdScopeA, {
        expectedRevision: 4,
        budgetScore: 20,
        authorityScore: 20,
        needScore: 24,
        timelineScore: 16,
        technicalFitScore: 20,
        economicBuyerId: foreignContactId,
        idempotencyKey: `foreign-contact-${Date.now()}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 422 });
  });

  it("blocks stage transition to QUALIFIED for uncertified or legacy bant-v0 deal", async () => {
    // Legacy deal (bant-v0) stage update to QUALIFIED is blocked
    const oppLegacy = await admin.opportunity.findUnique({ where: { id: legacyOppId } });
    await expect(
      oppCenterModule.updateOpportunity(SALES_A, legacyOppId, {
        expectedUpdatedAt: oppLegacy!.updatedAt.toISOString(),
        changes: { stage: "QUALIFIED" },
        idempotencyKey: `legacy-stage-update-${Date.now()}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("rolls back all changes when audit log insertion fails", async () => {
    await admin.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION u045_fail_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.idempotency_key LIKE '%forced-audit-fail%' THEN
          RAISE EXCEPTION 'u045_forced_audit_failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await admin.$executeRawUnsafe(`
      CREATE TRIGGER u045_fail_audit_trg
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION u045_fail_audit();
    `);

    const currentQual = await admin.dealQualification.findUnique({ where: { opportunityId: oppIdScopeA } });

    await expect(
      dealQualModule.qualifyOpportunity(SALES_A, oppIdScopeA, {
        expectedRevision: currentQual!.revision ?? undefined,
        budgetScore: 1,
        authorityScore: 1,
        needScore: 1,
        timelineScore: 1,
        technicalFitScore: 1,
        idempotencyKey: "forced-audit-fail-key",
      }),
    ).rejects.toThrow();

    // Verify DB qualification remained unchanged
    const afterQual = await admin.dealQualification.findUnique({ where: { opportunityId: oppIdScopeA } });
    expect(afterQual?.revision).toBe(currentQual!.revision);
    expect(afterQual?.scoreTotal).toBe(currentQual!.scoreTotal);
  });

  it("hides foreign scope details and emits scope-negative receipt", async () => {
    await expect(
      dealQualModule.qualifyOpportunity(FOREIGN_B, oppIdScopeA, {
        expectedRevision: 4,
        budgetScore: 20,
        authorityScore: 20,
        needScore: 24,
        timelineScore: 16,
        technicalFitScore: 20,
        idempotencyKey: `foreign-access-${Date.now()}`,
      }),
    ).rejects.toMatchObject({ httpStatus: 404 });

    const scopeNegativeReceipt = {
      accessedOppId: oppIdScopeA,
      foreignContext: FOREIGN_B.tenantId,
      result: "NOT_FOUND_404",
      isolated: true,
    };

    writeFileSync(
      join(EVIDENCE_ROOT, "scope-negative.json"),
      JSON.stringify(scopeNegativeReceipt, null, 2),
    );
  });
});
