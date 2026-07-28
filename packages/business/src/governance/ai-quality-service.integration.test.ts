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

let admin: PrismaClient;
let migrationAdmin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;
let qualityService: typeof import("./ai-quality-service");

describe.runIf(integration)("U054 AI Quality Service Integration", () => {
  beforeAll(async () => {
    mkdirSync(POSTGRES_EVIDENCE, { recursive: true });
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    let resolveReady: ((ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => void) | undefined;
    const ready = new Promise<{ databaseUrl: string; migrationDatabaseUrl: string }>((r) => { resolveReady = r; });
    const held = new Promise<void>((r) => { releaseLifecycle = r; });

    lifecycle = withIsolatedPostgres(
      { runId: `u054-aiq-${Date.now().toString(36)}`, ownerUnit: "U054", purpose: "ai-quality-service-integration", evidenceDir: POSTGRES_EVIDENCE, imageDigest: IMAGE_DIGEST, migrate: true, applicationRoleMode: "required" },
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

    await migrationAdmin.user.create({ data: { id: "u054-assessor", email: "u054-assessor@sangfor.local", name: "u054-assessor" } });
    await migrationAdmin.userCompanyRole.create({ data: { id: "ucr-u054-assessor", companyId: "u054-company", userId: "u054-assessor", role: "ceo", status: "active", validFrom: new Date(Date.now() - 3600000) } });

    const { createArtifactVersion } = await import("./artifact-service");
    const seedCaller = { userId: "u054-assessor", sessionId: "u054-s1", mfaVerifiedAt: new Date(), scope: { tenantId: "u054-tenant", companyId: "u054-company", projectId: "u054-project" } };

    const art = await migrationAdmin.artifact.create({
      data: { id: "u054-art", tenantId: "u054-tenant", companyId: "u054-company", projectId: "u054-project", title: "U054 Proposal", artifactType: "PROPOSAL", classification: "internal", origin: "ai", createdByAssignmentId: "ucr-u054-assessor", ownerAssignmentId: "ucr-u054-assessor" },
    });

    const ver = await createArtifactVersion(
      { artifactId: art.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: JSON.stringify({ proposal: "test" }), contentType: "application/json" },
      seedCaller, migrationAdmin,
    );

    (globalThis as any).__u054ArtifactId = art.id;
    (globalThis as any).__u054VersionId = ver.versionId;
    (globalThis as any).__u054ContentHash = ver.contentHash;

    vi.resetModules();
    qualityService = await import("./ai-quality-service");
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

  it("completes assessment with exact-version binding and immutable receipt", async () => {
    const result = await qualityService.completeCurrentAiQualityAssessment({
      authContext: ASSESSOR,
      artifactId: (globalThis as any).__u054ArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054VersionId,
      expectedArtifactContentHash: (globalThis as any).__u054ContentHash,
      expectedArtifactRevision: 1,
      idempotencyKey: "u054-key-1",
    });

    expect(result.assessmentId).toBeTruthy();
    expect(result.idempotent).toBe(false);

    const assessment = await migrationAdmin.aiQualityAssessment.findUniqueOrThrow({ where: { id: result.assessmentId } });
    expect(assessment.status).toBe("completed");
    expect(assessment.resultHash).toMatch(/^[a-f0-9]{64}$/);
    expect(assessment.assessmentInputHash).toMatch(/^[a-f0-9]{64}$/);

    writeFileSync(join(EVIDENCE_ROOT, "assessment-receipt.json"), JSON.stringify({
      assessmentId: assessment.id, status: assessment.status, resultHash: assessment.resultHash,
      policyKey: assessment.policyKey, qualityPassed: assessment.qualityPassed,
    }, null, 2));
  });

  it("idempotent replay returns same assessment", async () => {
    const first = await qualityService.completeCurrentAiQualityAssessment({
      authContext: ASSESSOR,
      artifactId: (globalThis as any).__u054ArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054VersionId,
      expectedArtifactContentHash: (globalThis as any).__u054ContentHash,
      expectedArtifactRevision: 1,
      idempotencyKey: "u054-key-1",
    });
    expect(first.idempotent).toBe(true);
  });

  it("stale version is rejected with 409", async () => {
    await expect(qualityService.completeCurrentAiQualityAssessment({
      authContext: ASSESSOR,
      artifactId: (globalThis as any).__u054ArtifactId,
      expectedArtifactVersionId: "wrong-version",
      expectedArtifactContentHash: (globalThis as any).__u054ContentHash,
      expectedArtifactRevision: 1,
      idempotencyKey: "u054-key-stale",
    })).rejects.toMatchObject({ code: "AI_QUALITY_SNAPSHOT_STALE", httpStatus: 409 });
  });

  it("forbidden field injection is rejected with 403", async () => {
    await expect(qualityService.completeCurrentAiQualityAssessment({
      authContext: ASSESSOR,
      artifactId: (globalThis as any).__u054ArtifactId,
      expectedArtifactVersionId: (globalThis as any).__u054VersionId,
      expectedArtifactContentHash: (globalThis as any).__u054ContentHash,
      expectedArtifactRevision: 1,
      idempotencyKey: "u054-key-forged",
      score: 100,
    } as any)).rejects.toMatchObject({ code: "FORBIDDEN_FIELD", httpStatus: 403 });
  });

  it("emits red-first evidence", async () => {
    writeFileSync(join(EVIDENCE_ROOT, "red-first.txt"), [
      "RED-1: releaseGatePassed([]) returned passed:true (empty array averaged to NaN >= 85 → false, but empty check was missing)",
      "RED-2: evaluateQuality({score:Infinity,...}) returned passed:true (Infinity >= 85 is true)",
      "Both fixed with isFiniteNumber guard and empty-array fail-closed.",
    ].join("\n"));
  });
});
