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
const EVIDENCE_ROOT = join(REPO_ROOT, ".omo/evidence/sangfor-system-refactor-2026-07-15/U054/attempt-1");
const POSTGRES_EVIDENCE = join(EVIDENCE_ROOT, "postgres-integration");

const ASSESSOR: AuthContext = {
  userId: "u054-assessor", sessionId: "u054-s1", tenantId: "u054-tenant",
  companyId: "u054-company", projectId: "u054-project",
  businessRole: "ceo", permissions: [], product: "portal",
};

const REVIEWER1: AuthContext = {
  userId: "u054-reviewer1", sessionId: "u054-s2", tenantId: "u054-tenant",
  companyId: "u054-company", projectId: "u054-project",
  businessRole: "presales_engineer", permissions: ["ai_quality.review" as any], product: "portal",
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
let evalService: typeof import("./ai-release-evaluation-service");

describe.runIf(integration)("U054 AI Release Evaluation Integration", () => {
  beforeAll(async () => {
    mkdirSync(POSTGRES_EVIDENCE, { recursive: true });
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    let resolveReady: ((ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => void) | undefined;
    const ready = new Promise<{ databaseUrl: string; migrationDatabaseUrl: string }>((r) => { resolveReady = r; });
    const held = new Promise<void>((r) => { releaseLifecycle = r; });

    lifecycle = withIsolatedPostgres(
      { runId: `u054-aire-${Date.now().toString(36)}`, ownerUnit: "U054", purpose: "ai-release-evaluation-integration", evidenceDir: POSTGRES_EVIDENCE, imageDigest: IMAGE_DIGEST, migrate: true, applicationRoleMode: "required" },
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

    for (const [uid, role] of [["u054-assessor", "ceo"], ["u054-reviewer1", "presales_engineer"], ["u054-reviewer2", "account_manager"]] as const) {
      await migrationAdmin.user.create({ data: { id: uid, email: `${uid}@sangfor.local`, name: uid } });
      await migrationAdmin.userCompanyRole.create({ data: { id: `ucr-${uid}`, companyId: "u054-company", userId: uid, role, status: "active", validFrom: new Date(Date.now() - 3600000) } });
    }

    const { createArtifactVersion } = await import("./artifact-service");
    const seedCaller = { userId: "u054-assessor", sessionId: "u054-s1", mfaVerifiedAt: new Date(), scope: { tenantId: "u054-tenant", companyId: "u054-company", projectId: "u054-project" } };

    const art = await migrationAdmin.artifact.create({
      data: { id: "u054-art-eval", tenantId: "u054-tenant", companyId: "u054-company", projectId: "u054-project", title: "U054 Proposal Eval", artifactType: "PROPOSAL", classification: "internal", origin: "ai", createdByAssignmentId: "ucr-u054-assessor", ownerAssignmentId: "ucr-u054-assessor" },
    });

    const ver = await createArtifactVersion(
      { artifactId: art.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: JSON.stringify({ proposal: "eval test" }), contentType: "application/json" },
      seedCaller, migrationAdmin,
    );

    (globalThis as any).__u054EvalArtifactId = art.id;
    (globalThis as any).__u054EvalVersionId = ver.versionId;
    (globalThis as any).__u054EvalContentHash = ver.contentHash;

    vi.resetModules();
    qualityService = await import("./ai-quality-service");
    reviewService = await import("./ai-quality-review-service");
    evalService = await import("./ai-release-evaluation-service");

    const assessmentRes = await qualityService.completeCurrentAiQualityAssessment({
      authContext: ASSESSOR,
      artifactId: art.id,
      expectedArtifactVersionId: ver.versionId,
      expectedArtifactContentHash: ver.contentHash,
      expectedArtifactRevision: 1,
      idempotencyKey: "u054-eval-asmt-1",
    });
    (globalThis as any).__u054AssessmentId = assessmentRes.assessmentId;

    const asmt = await migrationAdmin.aiQualityAssessment.findUniqueOrThrow({ where: { id: assessmentRes.assessmentId } });
    (globalThis as any).__u054AssessmentResultHash = asmt.resultHash;

    // Fill 2-of-2 reviews
    await reviewService.submitAiQualityReview({
      authContext: REVIEWER1, artifactId: art.id, expectedArtifactVersionId: ver.versionId,
      expectedArtifactContentHash: ver.contentHash, expectedArtifactRevision: 1,
      assessmentId: asmt.id, expectedAssessmentResultHash: asmt.resultHash,
      decision: "approved", idempotencyKey: "u054-eval-rev-1",
    });

    await reviewService.submitAiQualityReview({
      authContext: REVIEWER2, artifactId: art.id, expectedArtifactVersionId: ver.versionId,
      expectedArtifactContentHash: ver.contentHash, expectedArtifactRevision: 1,
      assessmentId: asmt.id, expectedAssessmentResultHash: asmt.resultHash,
      decision: "approved", idempotencyKey: "u054-eval-rev-2",
    });
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

  it("release selector rejects support_rca action for proposal wrapper (UNKNOWN_ACTION)", async () => {
    await expect(evalService.completeCurrentAiReleaseEvaluation({
      authContext: ASSESSOR,
      artifactId: (globalThis as any).__u054EvalArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054EvalVersionId,
      expectedArtifactContentHash: (globalThis as any).__u054EvalContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u054AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u054AssessmentResultHash,
      action: "support.rca.internal_approval",
      idempotencyKey: "u054-eval-rca-invalid",
    })).rejects.toMatchObject({ code: "UNKNOWN_ACTION", httpStatus: 422 });
  });

  it("2-of-2 approved assessment completes release evaluation and emits evidence receipt", async () => {
    const result = await evalService.completeCurrentAiReleaseEvaluation({
      authContext: ASSESSOR,
      artifactId: (globalThis as any).__u054EvalArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054EvalVersionId,
      expectedArtifactContentHash: (globalThis as any).__u054EvalContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u054AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u054AssessmentResultHash,
      action: "ai.customer_send",
      idempotencyKey: "u054-eval-success-1",
    });

    expect(result.evaluationId).toBeTruthy();
    expect(result.idempotent).toBe(false);

    const record = await migrationAdmin.aiReleaseEvaluation.findUniqueOrThrow({
      where: { id: result.evaluationId },
    });
    expect(record.action).toBe("ai.customer_send");
    expect(record.policyKey).toBe("proposal.human_review.v1");
    expect(record.eligible).toBe(false);
    expect(record.blockers).toEqual(["quality_not_passed"]);

    writeFileSync(join(POSTGRES_EVIDENCE, "release-evaluation-receipt.json"), JSON.stringify({
      id: record.id,
      assessmentId: record.assessmentId,
      action: record.action,
      policyKey: record.policyKey,
      eligible: record.eligible,
      blockers: record.blockers,
      evaluationInputHash: record.evaluationInputHash,
    }, null, 2));
  });

  it("idempotent replay returns same release evaluation result", async () => {
    const replay = await evalService.completeCurrentAiReleaseEvaluation({
      authContext: ASSESSOR,
      artifactId: (globalThis as any).__u054EvalArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054EvalVersionId,
      expectedArtifactContentHash: (globalThis as any).__u054EvalContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u054AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u054AssessmentResultHash,
      action: "ai.customer_send",
      idempotencyKey: "u054-eval-success-1",
    });

    expect(replay.idempotent).toBe(true);
  });
});
