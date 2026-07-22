import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error -- U009 lifecycle helper is plain JavaScript.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

import { createArtifactVersion, decideApprovalWithClient, evaluateArtifactRelease, submitApprovalRequest, type ApprovalKernelCaller } from "./index";

const integration = process.env.CI_INTEGRATION === "1";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const EVIDENCE_DIR = join(REPO_ROOT, ".omo/evidence/sangfor-system-refactor-2026-07-15/U023/attempt-1/integration-lifecycle");
const RUN_ID = `u023it${Date.now().toString(36)}`;
const scope = { tenantId: "u023-tenant", companyId: "u023-company", projectId: "u023-project" };
let prisma: PrismaClient;
let cleanup: (() => Promise<void>) | undefined;

function caller(): ApprovalKernelCaller {
  return { userId: "u023-user", sessionId: "u023-session", scope, mfaVerifiedAt: new Date() };
}

describe.skipIf(!integration)("artifact service (U009 isolated PostgreSQL)", () => {
  beforeAll(async () => {
    let ready!: (url: string) => void;
    const databaseReady = new Promise<string>((done) => { ready = done; });
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    const lifecycle = withIsolatedPostgres({ runId: RUN_ID, ownerUnit: "U023", purpose: "artifact-service-integration", evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true }, async (ctx: { databaseUrl: string }) => {
      ready(ctx.databaseUrl);
      await held;
    });
    cleanup = async () => { release(); await lifecycle; };
    const databaseUrl = await databaseReady;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.tenant.create({ data: { id: scope.tenantId, name: "U023 tenant", slug: scope.tenantId, status: "active" } });
    await prisma.company.create({ data: { id: scope.companyId, tenantId: scope.tenantId, name: "U023 company", slug: scope.companyId } });
    await prisma.project.create({ data: { id: scope.projectId, companyId: scope.companyId, name: "U023 project", slug: scope.projectId } });
    await prisma.user.create({ data: { id: "u023-user", email: "u023@example.test", name: "U023" } });
    await prisma.user.create({ data: { id: "u023-approver", email: "u023-approver@example.test", name: "U023 Approver" } });
    await prisma.userCompanyRole.create({ data: { id: "u023-assignment", userId: "u023-user", companyId: scope.companyId, role: "security_officer", status: "active" } });
    await prisma.userCompanyRole.create({ data: { id: "u023-approver-assignment", userId: "u023-approver", companyId: scope.companyId, role: "security_officer", status: "active" } });
    await prisma.artifact.create({ data: { id: "u023-artifact", ...scope, artifactType: "proposal", classification: "internal", origin: "human", title: "U023", createdByAssignmentId: "u023-assignment", ownerAssignmentId: "u023-assignment" } });
  }, 180_000);

  afterAll(async () => { await prisma?.$disconnect(); await cleanup?.(); }, 60_000);

  it("executes the U023 real-surface sequence: save v1, approve/evaluate, race v2, then stale/pending evaluation", async () => {
    const first = await prisma.$transaction((tx) => createArtifactVersion({ artifactId: "u023-artifact", expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: '{"title":"v1"}', contentType: "application/json" }, caller(), tx));
    expect(first.revision).toBe(1);
    const readyApproval = await prisma.$transaction((tx) => submitApprovalRequest({ action: "release", artifactVersionId: first.versionId, artifactHash: first.contentHash, policyVersion: "v1", requiredQuorum: 1 }, caller(), tx));
    const approved = await prisma.$transaction((tx) => decideApprovalWithClient(tx, { approvalId: readyApproval.request.id, decision: "approve", expectedRevision: readyApproval.request.revision }, { ...caller(), userId: "u023-approver", sessionId: "u023-approver-session" }));
    await expect(evaluateArtifactRelease({ action: "release", artifactVersionId: first.versionId, approvalId: approved.request.id }, caller(), prisma)).resolves.toMatchObject({ releasable: true, reasonCode: "RELEASABLE" });
    const race = await Promise.allSettled([
      prisma.$transaction((tx) => createArtifactVersion({ artifactId: "u023-artifact", expectedCurrentVersionId: first.versionId, expectedCurrentRevision: 1, content: '{"title":"v2-a"}', contentType: "application/json" }, caller(), tx)),
      prisma.$transaction((tx) => createArtifactVersion({ artifactId: "u023-artifact", expectedCurrentVersionId: first.versionId, expectedCurrentRevision: 1, content: '{"title":"v2-b"}', contentType: "application/json" }, caller(), tx)),
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: "u023-artifact" }, include: { versions: { orderBy: { version: "asc" } } } });
    expect(artifact.currentRevision).toBe(2);
    expect(artifact.versions).toHaveLength(2);
    expect(artifact.versions[0]).toMatchObject({ id: first.versionId, version: 1 });
    const v2 = artifact.versions[1]!;
    await expect(evaluateArtifactRelease({ action: "release", artifactVersionId: first.versionId, approvalId: approved.request.id }, caller(), prisma)).resolves.toMatchObject({ releasable: false, reasonCode: "STALE_ARTIFACT_VERSION" });
    const pendingV2 = await prisma.$transaction((tx) => submitApprovalRequest({ action: "release", artifactVersionId: v2.id, artifactHash: v2.contentHash, policyVersion: "v1", requiredQuorum: 1 }, caller(), tx));
    await expect(evaluateArtifactRelease({ action: "release", artifactVersionId: v2.id, approvalId: pendingV2.request.id }, caller(), prisma)).resolves.toMatchObject({ releasable: false, reasonCode: "APPROVAL_NOT_APPROVED" });
    await expect(prisma.outboxEvent.count({ where: { eventType: { contains: "release" } } })).resolves.toBe(0);
    const audits = await prisma.auditLog.findMany({ where: { projectId: scope.projectId }, orderBy: { sequence: "asc" }, select: { sequence: true, eventType: true } });
    expect(audits.map((audit) => audit.sequence)).toEqual(audits.map((_audit, index) => index + 1));
  });
});
