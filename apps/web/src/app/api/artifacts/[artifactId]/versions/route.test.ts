import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const db = vi.hoisted(() => ({ authSessionFindUnique: vi.fn(), userFindUnique: vi.fn() }));
const business = vi.hoisted(() => ({ createArtifactVersion: vi.fn() }));
vi.mock("@sangfor/db", () => ({ prisma: { authSession: { findUnique: db.authSessionFindUnique }, user: { findUnique: db.userFindUnique } } }));
vi.mock("@sangfor/business", async (original) => ({ ...(await original<typeof import("@sangfor/business")>()), createArtifactVersion: business.createArtifactVersion }));

import { signSessionJwt } from "@sangfor/auth";
import { POST } from "./route";

const scope = { tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" };
function env() { return { USER_JWT_ACTIVE_KID: "artifact-route-key", USER_JWT_ROTATION_OWNER: "security-auth", USER_JWT_ISSUER: "sangfor-os", USER_JWT_AUDIENCE: "sangfor-os-runtime", USER_JWT_TTL_SECONDS: "900", USER_JWT_CLOCK_SKEW_SECONDS: "30", USER_JWT_KEYRING_JSON: JSON.stringify({ version: "sangfor.user-jwt-keyring/v1", keys: [{ kid: "artifact-route-key", state: "active", secretBase64Url: Buffer.alloc(32, 1).toString("base64url"), activatedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), demotedAt: null, verifyUntil: null, retiredAt: null }] }) }; }
function request(body: unknown) { const jti = "artifact-session"; db.authSessionFindUnique.mockResolvedValueOnce({ id: jti, userId: "user-1", ...scope, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), revokedAt: null, mfaVerifiedAt: new Date(), mfaMethod: "totp" }); db.userFindUnique.mockResolvedValueOnce({ id: "user-1", status: "active", disabledAt: null }); return new Request("http://localhost/api/artifacts/artifact-1/versions", { method: "POST", headers: { authorization: `Bearer ${signSessionJwt({ sub: "user-1", jti, ...scope, projectSlug: "p", product: "portal", role: "operator" })}`, "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_BYPASS_ENABLED", ""); for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value); });
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/artifacts/[artifactId]/versions", () => {
  it("rejects body actor, hash, and foreign scope rather than trusting them", async () => {
    expect([400, 422]).toContain((await POST(request({ expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: "{}", contentType: "application/json", actorId: "forged" }), { params: Promise.resolve({ artifactId: "artifact-1" }) })).status);
    expect((await POST(request({ expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: "{}", contentType: "application/json", companyId: "foreign" }), { params: Promise.resolve({ artifactId: "artifact-1" }) })).status).toBe(403);
  });
  it("uses the canonical [artifactId] segment and server AuthContext", async () => {
    business.createArtifactVersion.mockResolvedValueOnce({ artifactId: "artifact-1", versionId: "version-1", revision: 1, contentHash: "hash", idempotent: false });
    const response = await POST(request({ expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: "{}", contentType: "application/json" }), { params: Promise.resolve({ artifactId: "artifact-1" }) });
    expect(response.status).toBe(201);
    expect(business.createArtifactVersion).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "artifact-1" }), expect.objectContaining({ scope }));
  });
});

const integration = process.env.CI_INTEGRATION === "1";

function databaseRequest(url: string, body: unknown, ids: { userId: string; sessionId: string }, requestScope = scope) {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${signSessionJwt({ sub: ids.userId, jti: ids.sessionId, ...requestScope, projectSlug: "u023", product: "portal", role: "operator" })}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!integration)("U023 real route surface (task-owned U009 PostgreSQL)", () => {
  it("saves v1, evaluates approved v1, races v2, and evaluates stale/pending versions without a release side effect", async () => {
    const client = new PrismaClient();
    const suffix = `u023-route-${Date.now().toString(36)}`;
    const ids = { tenantId: `${suffix}-tenant`, companyId: `${suffix}-company`, projectId: `${suffix}-project`, userId: `${suffix}-writer`, sessionId: `${suffix}-session` };
    const approver = `${suffix}-approver`;
    try {
      await client.tenant.create({ data: { id: ids.tenantId, name: "U023 route tenant", slug: ids.tenantId, status: "active" } });
      await client.company.create({ data: { id: ids.companyId, tenantId: ids.tenantId, name: "U023 route company", slug: ids.companyId } });
      await client.project.create({ data: { id: ids.projectId, companyId: ids.companyId, name: "U023 route project", slug: ids.projectId } });
      await client.user.create({ data: { id: ids.userId, email: `${suffix}-writer@example.test`, name: "writer", status: "active" } });
      await client.user.create({ data: { id: approver, email: `${suffix}-approver@example.test`, name: "approver", status: "active" } });
      await client.userCompanyRole.create({ data: { id: `${suffix}-writer-role`, userId: ids.userId, companyId: ids.companyId, role: "security_officer", status: "active" } });
      await client.userCompanyRole.create({ data: { id: `${suffix}-approver-role`, userId: approver, companyId: ids.companyId, role: "security_officer", status: "active" } });
      await client.authSession.create({ data: { id: ids.sessionId, userId: ids.userId, tenantId: ids.tenantId, companyId: ids.companyId, projectId: ids.projectId, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), mfaVerifiedAt: new Date(), mfaMethod: "totp" } });
      const artifact = await client.artifact.create({ data: { id: `${suffix}-artifact`, tenantId: ids.tenantId, companyId: ids.companyId, projectId: ids.projectId, artifactType: "proposal", classification: "internal", origin: "human", title: "U023 route artifact", createdByAssignmentId: `${suffix}-writer-role`, ownerAssignmentId: `${suffix}-writer-role` } });

      // The ordinary unit tests intentionally mock the service boundary. This branch drops those
      // mocks and invokes the exported App Router handlers against the task-owned database.
      vi.doUnmock("@sangfor/db");
      vi.doUnmock("@sangfor/business");
      vi.resetModules();
      const versionsRoute = await import("./route");
      const releaseRoute = await import("../release-evaluation/route");
      const businessActual = await import("@sangfor/business");
      const routeScope = { tenantId: ids.tenantId, companyId: ids.companyId, projectId: ids.projectId };
      const routeIds = { userId: ids.userId, sessionId: ids.sessionId };
      const params = { params: Promise.resolve({ artifactId: artifact.id }) };
      const v1Response = await versionsRoute.POST(databaseRequest(`http://localhost/api/artifacts/${artifact.id}/versions`, { expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: '{"title":"v1"}', contentType: "application/json" }, routeIds, routeScope), params);
      expect(v1Response.status).toBe(201);
      const v1 = (await v1Response.json()).data as { versionId: string; contentHash: string };
      const approval = await businessActual.submitApprovalRequest({ action: "release", artifactVersionId: v1.versionId, artifactHash: v1.contentHash, policyVersion: "v1", requiredQuorum: 1 }, { userId: ids.userId, sessionId: ids.sessionId, scope: routeScope, mfaVerifiedAt: new Date() });
      await businessActual.decideApproval({ approvalId: approval.request.id, decision: "approve", expectedRevision: approval.request.revision }, { userId: approver, sessionId: `${suffix}-approver-session`, scope: routeScope, mfaVerifiedAt: new Date() });
      const approvedResponse = await releaseRoute.POST(databaseRequest(`http://localhost/api/artifacts/${artifact.id}/release-evaluation`, { action: "release", artifactVersionId: v1.versionId, approvalId: approval.request.id }, routeIds, routeScope), params);
      expect((await approvedResponse.json()).data).toMatchObject({ releasable: true, reasonCode: "RELEASABLE" });

      const raced = await Promise.all([
        versionsRoute.POST(databaseRequest(`http://localhost/api/artifacts/${artifact.id}/versions`, { expectedCurrentVersionId: v1.versionId, expectedCurrentRevision: 1, content: '{"title":"v2-a"}', contentType: "application/json" }, routeIds, routeScope), params),
        versionsRoute.POST(databaseRequest(`http://localhost/api/artifacts/${artifact.id}/versions`, { expectedCurrentVersionId: v1.versionId, expectedCurrentRevision: 1, content: '{"title":"v2-b"}', contentType: "application/json" }, routeIds, routeScope), params),
      ]);
      expect(raced.map((response) => response.status).sort()).toEqual([201, 409]);
      const staleResponse = await releaseRoute.POST(databaseRequest(`http://localhost/api/artifacts/${artifact.id}/release-evaluation`, { action: "release", artifactVersionId: v1.versionId, approvalId: approval.request.id }, routeIds, routeScope), params);
      expect((await staleResponse.json()).data).toMatchObject({ releasable: false, reasonCode: "STALE_ARTIFACT_VERSION" });
      const stored = await client.artifact.findUniqueOrThrow({ where: { id: artifact.id }, include: { versions: { orderBy: { version: "asc" } } } });
      const v2 = stored.versions[1]!;
      const pending = await businessActual.submitApprovalRequest({ action: "release", artifactVersionId: v2.id, artifactHash: v2.contentHash, policyVersion: "v1", requiredQuorum: 1 }, { userId: ids.userId, sessionId: ids.sessionId, scope: routeScope, mfaVerifiedAt: new Date() });
      const pendingResponse = await releaseRoute.POST(databaseRequest(`http://localhost/api/artifacts/${artifact.id}/release-evaluation`, { action: "release", artifactVersionId: v2.id, approvalId: pending.request.id }, routeIds, routeScope), params);
      expect((await pendingResponse.json()).data).toMatchObject({ releasable: false, reasonCode: "APPROVAL_NOT_APPROVED" });
      const audits = await client.auditLog.findMany({ where: { projectId: ids.projectId }, orderBy: { sequence: "asc" }, select: { sequence: true, eventType: true } });
      await mkdir(resolve(process.cwd(), "../../.omo/evidence/sangfor-system-refactor-2026-07-15/U023/attempt-1"), { recursive: true });
      await writeFile(resolve(process.cwd(), "../../.omo/evidence/sangfor-system-refactor-2026-07-15/U023/attempt-1/real-route-surface.json"), JSON.stringify({ v1: { id: v1.versionId, hash: v1.contentHash }, versions: stored.versions.map((version) => ({ id: version.id, version: version.version, hash: version.contentHash })), auditSequence: audits, cleanup: "U009 isolated-postgres outer lifecycle owns container cleanup" }, null, 2));
      await expect(client.outboxEvent.count({ where: { eventType: { contains: "release" } } })).resolves.toBe(0);
    } finally {
      await client.$disconnect();
    }
  }, 120_000);
});
