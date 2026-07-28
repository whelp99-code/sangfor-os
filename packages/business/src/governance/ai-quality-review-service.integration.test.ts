import type { AuthContext } from "@sangfor/auth";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { applyU043RlsGrants } from "../crm/u043-grant.fixture";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const EVIDENCE_ROOT = join(REPO_ROOT, ".omo/evidence/sangfor-system-refactor-2026-07-15/U054/attempt-1");
const POSTGRES_EVIDENCE = join(EVIDENCE_ROOT, "postgres-integration");

const ASSESSOR: AuthContext = {
  userId: "u054-assessor", sessionId: "u054-s1", tenantId: "u054-tenant",
  companyId: "u054-company", projectId: "u054-project",
  businessRole: "ceo", permissions: ["ai_quality.review" as any], product: "portal",
};

const ASSESSOR_ALT: AuthContext = {
  userId: "u054-assessor", sessionId: "u054-s1-alt", tenantId: "u054-tenant",
  companyId: "u054-company", projectId: "u054-project",
  businessRole: "presales_engineer", permissions: ["ai_quality.review" as any], product: "portal",
};

const REVIEWER1: AuthContext = {
  userId: "u054-reviewer1", sessionId: "u054-s2", tenantId: "u054-tenant",
  companyId: "u054-company", projectId: "u054-project",
  businessRole: "presales_engineer", permissions: ["ai_quality.review" as any], product: "portal",
};

const REVIEWER1_ALT: AuthContext = {
  userId: "u054-reviewer1", sessionId: "u054-s2-alt", tenantId: "u054-tenant",
  companyId: "u054-company", projectId: "u054-project",
  businessRole: "account_manager", permissions: ["ai_quality.review" as any], product: "portal",
};

const REVIEWER2: AuthContext = {
  userId: "u054-reviewer2", sessionId: "u054-s3", tenantId: "u054-tenant",
  companyId: "u054-company", projectId: "u054-project",
  businessRole: "account_manager", permissions: ["ai_quality.review" as any], product: "portal",
};

let admin: PrismaClient;
let migrationAdmin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;
let qualityService: typeof import("./ai-quality-service");
let reviewService: typeof import("./ai-quality-review-service");

describe.runIf(integration)("U054 AI Quality Review Integration", () => {
  beforeAll(async () => {
    mkdirSync(POSTGRES_EVIDENCE, { recursive: true });
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    let resolveReady: ((ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => void) | undefined;
    const ready = new Promise<{ databaseUrl: string; migrationDatabaseUrl: string }>((r) => { resolveReady = r; });
    const held = new Promise<void>((r) => { releaseLifecycle = r; });

    lifecycle = withIsolatedPostgres(
      { runId: `u054-aiqr-${Date.now().toString(36)}`, ownerUnit: "U054", purpose: "ai-quality-review-integration", evidenceDir: POSTGRES_EVIDENCE, imageDigest: IMAGE_DIGEST, migrate: true, applicationRoleMode: "required" },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => { resolveReady?.(ctx); await held; },
    );

    const scratch = await ready;
    process.env.DATABASE_URL = scratch.migrationDatabaseUrl;
    process.env.SANGFOR_APP_DATABASE_URL = scratch.databaseUrl;

    migrationAdmin = new PrismaClient({ datasources: { db: { url: scratch.migrationDatabaseUrl } } });
    admin = new PrismaClient({ datasources: { db: { url: scratch.databaseUrl } } });

    await applyU043RlsGrants(migrationAdmin);

    const tables = [
      "artifacts", "artifact_versions", "ai_quality_assessments", "ai_quality_evidence",
      "ai_quality_reviews", "ai_release_evaluations", "ai_prompt_snapshots", "ai_model_snapshots",
      "approval_requests", "approval_decisions", "approval_current_validities", "outbox_events",
    ];
    for (const t of tables) {
      try {
        const [{ regclass }] = await migrationAdmin.$queryRawUnsafe<{ regclass: string | null }[]>(`SELECT to_regclass('public."${t}"')::text as regclass;`);
        if (regclass) await migrationAdmin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${t}" TO sangfor_app;`);
      } catch { /* skip */ }
    }

    await migrationAdmin.tenant.create({ data: { id: "u054-tenant", slug: "u054-tenant", name: "U054", status: "active" } });
    await migrationAdmin.company.create({ data: { id: "u054-company", tenantId: "u054-tenant", slug: "u054-company", name: "U054 Co" } });
    await migrationAdmin.project.create({ data: { id: "u054-project", companyId: "u054-company", slug: "u054-project", name: "U054 Proj" } });

    // Seed primary user company roles
    await migrationAdmin.user.create({ data: { id: "u054-assessor", email: "u054-assessor@sangfor.local", name: "u054-assessor" } });
    await migrationAdmin.userCompanyRole.create({ data: { id: "ucr-u054-assessor", companyId: "u054-company", userId: "u054-assessor", role: "ceo", status: "active", validFrom: new Date(Date.now() - 3600000) } });

    await migrationAdmin.user.create({ data: { id: "u054-reviewer1", email: "u054-reviewer1@sangfor.local", name: "u054-reviewer1" } });
    await migrationAdmin.userCompanyRole.create({ data: { id: "ucr-u054-reviewer1", companyId: "u054-company", userId: "u054-reviewer1", role: "presales_engineer", status: "active", validFrom: new Date(Date.now() - 3600000) } });

    await migrationAdmin.user.create({ data: { id: "u054-reviewer2", email: "u054-reviewer2@sangfor.local", name: "u054-reviewer2" } });
    await migrationAdmin.userCompanyRole.create({ data: { id: "ucr-u054-reviewer2", companyId: "u054-company", userId: "u054-reviewer2", role: "account_manager", status: "active", validFrom: new Date(Date.now() - 3600000) } });

    const { createArtifactVersion } = await import("./artifact-service");
    const seedCaller = { userId: "u054-assessor", sessionId: "u054-s1", mfaVerifiedAt: new Date(), scope: { tenantId: "u054-tenant", companyId: "u054-company", projectId: "u054-project" } };

    const art = await migrationAdmin.artifact.create({
      data: { id: "u054-art-rev", tenantId: "u054-tenant", companyId: "u054-company", projectId: "u054-project", title: "U054 Proposal Review", artifactType: "PROPOSAL", classification: "internal", origin: "ai", createdByAssignmentId: "ucr-u054-assessor", ownerAssignmentId: "ucr-u054-assessor" },
    });

    const ver = await createArtifactVersion(
      { artifactId: art.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: JSON.stringify({ proposal: "review test" }), contentType: "application/json" },
      seedCaller, migrationAdmin,
    );

    (globalThis as any).__u054RevArtifactId = art.id;
    (globalThis as any).__u054RevVersionId = ver.versionId;
    (globalThis as any).__u054RevContentHash = ver.contentHash;

    vi.resetModules();
    qualityService = await import("./ai-quality-service");
    reviewService = await import("./ai-quality-review-service");

    const assessmentRes = await qualityService.completeCurrentAiQualityAssessment({
      authContext: ASSESSOR,
      artifactId: art.id,
      expectedArtifactVersionId: ver.versionId,
      expectedArtifactContentHash: ver.contentHash,
      expectedArtifactRevision: 1,
      idempotencyKey: "u054-rev-asmt-1",
    });
    (globalThis as any).__u054AssessmentId = assessmentRes.assessmentId;

    const asmt = await migrationAdmin.aiQualityAssessment.findUniqueOrThrow({ where: { id: assessmentRes.assessmentId } });
    (globalThis as any).__u054AssessmentResultHash = asmt.resultHash;

    // Now seed secondary alternate membership roles for dual-role separation test
    await migrationAdmin.userCompanyRole.create({ data: { id: "ucr-u054-assessor-alt", companyId: "u054-company", userId: "u054-assessor", role: "presales_engineer", status: "active", validFrom: new Date(Date.now() - 3600000) } });
    await migrationAdmin.userCompanyRole.create({ data: { id: "ucr-u054-reviewer1-alt", companyId: "u054-company", userId: "u054-reviewer1", role: "account_manager", status: "active", validFrom: new Date(Date.now() - 3600000) } });
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

  it("assessor cannot review own assessment directly or via alternate membership (403)", async () => {
    // Direct same assignment
    await expect(reviewService.submitAiQualityReview({
      authContext: ASSESSOR,
      artifactId: (globalThis as any).__u054RevArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054RevVersionId,
      expectedArtifactContentHash: (globalThis as any).__u054RevContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u054AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u054AssessmentResultHash,
      decision: "approved",
      idempotencyKey: "u054-review-assessor-direct",
    })).rejects.toMatchObject({ code: "ASSESSOR_CANNOT_REVIEW", httpStatus: 403 });

    // Alternate membership under same User ID
    await expect(reviewService.submitAiQualityReview({
      authContext: ASSESSOR_ALT,
      artifactId: (globalThis as any).__u054RevArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054RevVersionId,
      expectedArtifactContentHash: (globalThis as any).__u054RevContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u054AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u054AssessmentResultHash,
      decision: "approved",
      idempotencyKey: "u054-review-assessor-alt",
    })).rejects.toMatchObject({ code: "ASSESSOR_CANNOT_REVIEW", httpStatus: 403 });
  });

  it("review slot 1 by presales_engineer succeeds", async () => {
    const result = await reviewService.submitAiQualityReview({
      authContext: REVIEWER1,
      artifactId: (globalThis as any).__u054RevArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054RevVersionId,
      expectedArtifactContentHash: (globalThis as any).__u054RevContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u054AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u054AssessmentResultHash,
      decision: "approved",
      idempotencyKey: "u054-review-slot1",
    });

    expect(result.reviewId).toBeTruthy();
    expect(result.idempotent).toBe(false);
  });

  it("same underlying user cannot fill slot 2 via alternate membership (409 DUPLICATE_REVIEWER)", async () => {
    await expect(reviewService.submitAiQualityReview({
      authContext: REVIEWER1_ALT,
      artifactId: (globalThis as any).__u054RevArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054RevVersionId,
      expectedArtifactContentHash: (globalThis as any).__u054RevContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u054AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u054AssessmentResultHash,
      decision: "approved",
      idempotencyKey: "u054-review-slot2-duplicate-user",
    })).rejects.toMatchObject({ code: "DUPLICATE_REVIEWER", httpStatus: 409 });
  });

  it("review slot 2 by separate account_manager user succeeds", async () => {
    const result = await reviewService.submitAiQualityReview({
      authContext: REVIEWER2,
      artifactId: (globalThis as any).__u054RevArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054RevVersionId,
      expectedArtifactContentHash: (globalThis as any).__u054RevContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u054AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u054AssessmentResultHash,
      decision: "approved",
      idempotencyKey: "u054-review-slot2-valid",
    });

    expect(result.reviewId).toBeTruthy();
  });
});
