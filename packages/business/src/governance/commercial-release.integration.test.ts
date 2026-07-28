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
const EVIDENCE_ROOT = join(REPO_ROOT, ".omo/evidence/sangfor-system-refactor-2026-07-15/U055/attempt-1");
const POSTGRES_EVIDENCE = join(EVIDENCE_ROOT, "postgres-integration");

const ASSESSOR: AuthContext = {
  userId: "u055-assessor", sessionId: "u055-s1", tenantId: "u055-tenant",
  companyId: "u055-company", projectId: "u055-project",
  businessRole: "ceo", permissions: ["ai_quality.review" as any], product: "portal",
};

const SALES_REVIEWER: AuthContext = {
  userId: "u055-sales", sessionId: "u055-s2", tenantId: "u055-tenant",
  companyId: "u055-company", projectId: "u055-project",
  businessRole: "sales_manager", permissions: ["ai_quality.review" as any], product: "portal",
};

const FINANCE_REVIEWER: AuthContext = {
  userId: "u055-finance", sessionId: "u055-s3", tenantId: "u055-tenant",
  companyId: "u055-company", projectId: "u055-project",
  businessRole: "finance_manager", permissions: ["ai_quality.review" as any], product: "portal",
};

let admin: PrismaClient;
let migrationAdmin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;
let qualityService: typeof import("./ai-quality-service");
let reviewService: typeof import("./ai-quality-review-service");
let commercialReleaseService: typeof import("./commercial-release");

describe.runIf(integration)("U055 Governed Commercial Release Integration", () => {
  beforeAll(async () => {
    mkdirSync(POSTGRES_EVIDENCE, { recursive: true });
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    let resolveReady: ((ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => void) | undefined;
    const ready = new Promise<{ databaseUrl: string; migrationDatabaseUrl: string }>((r) => { resolveReady = r; });
    const held = new Promise<void>((r) => { releaseLifecycle = r; });

    lifecycle = withIsolatedPostgres(
      { runId: `u055-crel-${Date.now().toString(36)}`, ownerUnit: "U055", purpose: "commercial-release-integration", evidenceDir: POSTGRES_EVIDENCE, imageDigest: IMAGE_DIGEST, migrate: true, applicationRoleMode: "required" },
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
      "opportunities", "quotes",
    ];
    for (const t of tables) {
      try {
        const [{ regclass }] = await migrationAdmin.$queryRawUnsafe<{ regclass: string | null }[]>(`SELECT to_regclass('public."${t}"')::text as regclass;`);
        if (regclass) await migrationAdmin.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${t}" TO sangfor_app;`);
      } catch { /* skip */ }
    }

    await migrationAdmin.tenant.create({ data: { id: "u055-tenant", slug: "u055-tenant", name: "U055", status: "active" } });
    await migrationAdmin.company.create({ data: { id: "u055-company", tenantId: "u055-tenant", slug: "u055-company", name: "U055 Co" } });
    await migrationAdmin.project.create({ data: { id: "u055-project", companyId: "u055-company", slug: "u055-project", name: "U055 Proj" } });

    // Seed users
    for (const [uid, role] of [["u055-assessor", "ceo"], ["u055-sales", "sales_manager"], ["u055-finance", "finance_manager"]] as const) {
      await migrationAdmin.user.create({ data: { id: uid, email: `${uid}@sangfor.local`, name: uid } });
      await migrationAdmin.userCompanyRole.create({ data: { id: `ucr-${uid}`, companyId: "u055-company", userId: uid, role, status: "active", validFrom: new Date(Date.now() - 3600000) } });
    }

    const { createArtifactVersion } = await import("./artifact-service");
    const seedCaller = { userId: "u055-assessor", sessionId: "u055-s1", mfaVerifiedAt: new Date(), scope: { tenantId: "u055-tenant", companyId: "u055-company", projectId: "u055-project" } };

    const art = await migrationAdmin.artifact.create({
      data: { id: "u055-art-quote", tenantId: "u055-tenant", companyId: "u055-company", projectId: "u055-project", title: "U055 Quote Artifact", artifactType: "QUOTE", classification: "internal", origin: "ai", createdByAssignmentId: "ucr-u055-assessor", ownerAssignmentId: "ucr-u055-assessor" },
    });

    const ver = await createArtifactVersion(
      { artifactId: art.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: JSON.stringify({ quote: "commercial release test" }), contentType: "application/json" },
      seedCaller, migrationAdmin,
    );

    const opp = await migrationAdmin.opportunity.create({
      data: { id: "u055-opp1", projectId: "u055-project", title: "U055 Opp", stage: "PROPOSAL" },
    });

    const quote = await migrationAdmin.quote.create({
      data: {
        id: "u055-quote1", companyId: "u055-company", opportunityId: opp.id, version: 1,
        totalRevenue: 20000, totalCost: 10000, marginPct: 50, createdBy: "ucr-u055-assessor",
        artifactVersionId: ver.versionId, contentHash: ver.contentHash,
      },
    });

    (globalThis as any).__u055ArtifactId = art.id;
    (globalThis as any).__u055VersionId = ver.versionId;
    (globalThis as any).__u055ContentHash = ver.contentHash;
    (globalThis as any).__u055QuoteId = quote.id;

    vi.resetModules();
    qualityService = await import("./ai-quality-service");
    reviewService = await import("./ai-quality-review-service");
    commercialReleaseService = await import("./commercial-release");

    // Complete initial assessment
    const assessmentRes = await qualityService.completeCurrentAiQualityAssessment({
      authContext: ASSESSOR,
      artifactId: art.id,
      expectedArtifactVersionId: ver.versionId,
      expectedArtifactContentHash: ver.contentHash,
      expectedArtifactRevision: 1,
      idempotencyKey: "u055-quote-asmt-1",
    });
    (globalThis as any).__u055AssessmentId = assessmentRes.assessmentId;

    const asmt = await migrationAdmin.aiQualityAssessment.findUniqueOrThrow({ where: { id: assessmentRes.assessmentId } });
    (globalThis as any).__u055AssessmentResultHash = asmt.resultHash;

    // Fill 2-of-2 required reviews for quote.internal_release.human_review.v1 (sales_manager, finance_manager)
    await reviewService.submitAiQualityReview({
      authContext: SALES_REVIEWER, artifactId: art.id, expectedArtifactVersionId: ver.versionId,
      expectedArtifactContentHash: ver.contentHash, expectedArtifactRevision: 1,
      assessmentId: asmt.id, expectedAssessmentResultHash: asmt.resultHash,
      decision: "approved", idempotencyKey: "u055-rev-sales-1",
    });

    await reviewService.submitAiQualityReview({
      authContext: FINANCE_REVIEWER, artifactId: art.id, expectedArtifactVersionId: ver.versionId,
      expectedArtifactContentHash: ver.contentHash, expectedArtifactRevision: 1,
      assessmentId: asmt.id, expectedAssessmentResultHash: asmt.resultHash,
      decision: "approved", idempotencyKey: "u055-rev-finance-1",
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

  it("releases governed quote after commercial approval and 2-of-2 reviews", async () => {
    const result = await commercialReleaseService.releaseGovernedQuote({
      authContext: ASSESSOR,
      quoteId: (globalThis as any).__u055QuoteId,
      expectedQuoteRevision: 1,
      artifactId: (globalThis as any).__u055ArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u055VersionId,
      expectedArtifactContentHash: (globalThis as any).__u055ContentHash,
      expectedArtifactRevision: 1,
      assessmentId: (globalThis as any).__u055AssessmentId,
      expectedAssessmentResultHash: (globalThis as any).__u055AssessmentResultHash,
      idempotencyKey: "u055-comm-rel-key-1",
    });

    expect(result.evaluationId).toBeTruthy();
    expect(result.action).toBe("quote.internal_release");
    expect(result.policyKey).toBe("quote.internal_release.human_review.v1");

    writeFileSync(join(POSTGRES_EVIDENCE, "commercial-release-receipt.json"), JSON.stringify(result, null, 2));
  });
});
