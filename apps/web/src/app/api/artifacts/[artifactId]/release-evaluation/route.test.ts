import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ authSessionFindUnique: vi.fn(), userFindUnique: vi.fn() }));
const business = vi.hoisted(() => ({ evaluateArtifactRelease: vi.fn() }));
vi.mock("@sangfor/db", () => ({ prisma: { authSession: { findUnique: db.authSessionFindUnique }, user: { findUnique: db.userFindUnique } } }));
vi.mock("@sangfor/business", async (original) => ({ ...(await original<typeof import("@sangfor/business")>()), evaluateArtifactRelease: business.evaluateArtifactRelease }));

import { signSessionJwt } from "@sangfor/auth";
import { POST } from "./route";

const scope = { tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" };
function env() { return { USER_JWT_ACTIVE_KID: "release-route-key", USER_JWT_ROTATION_OWNER: "security-auth", USER_JWT_ISSUER: "sangfor-os", USER_JWT_AUDIENCE: "sangfor-os-runtime", USER_JWT_TTL_SECONDS: "900", USER_JWT_CLOCK_SKEW_SECONDS: "30", USER_JWT_KEYRING_JSON: JSON.stringify({ version: "sangfor.user-jwt-keyring/v1", keys: [{ kid: "release-route-key", state: "active", secretBase64Url: Buffer.alloc(32, 2).toString("base64url"), activatedAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), demotedAt: null, verifyUntil: null, retiredAt: null }] }) }; }
function request(body: unknown) { const jti = "release-session"; db.authSessionFindUnique.mockResolvedValueOnce({ id: jti, userId: "user-1", ...scope, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), revokedAt: null, mfaVerifiedAt: new Date(), mfaMethod: "totp" }); db.userFindUnique.mockResolvedValueOnce({ id: "user-1", status: "active", disabledAt: null }); return new Request("http://localhost/api/artifacts/artifact-1/release-evaluation", { method: "POST", headers: { authorization: `Bearer ${signSessionJwt({ sub: "user-1", jti, ...scope, projectSlug: "p", product: "portal", role: "operator" })}`, "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_BYPASS_ENABLED", ""); for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value); });
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/artifacts/[artifactId]/release-evaluation", () => {
  it("rejects caller hash/actor and foreign scope fields", async () => {
    expect([400, 422]).toContain((await POST(request({ action: "release", artifactVersionId: "version-1", approvalId: "approval-1", hash: "forged" }), { params: Promise.resolve({ artifactId: "artifact-1" }) })).status);
    expect((await POST(request({ action: "release", artifactVersionId: "version-1", approvalId: "approval-1", projectId: "foreign" }), { params: Promise.resolve({ artifactId: "artifact-1" }) })).status).toBe(403);
  });
  it("returns a reason-coded side-effect-free decision bound to [artifactId]", async () => {
    business.evaluateArtifactRelease.mockResolvedValueOnce({ releasable: false, reasonCode: "STALE_ARTIFACT_VERSION", artifactId: "artifact-1", artifactVersionId: "version-1", approvalId: "approval-1", revision: 2 });
    const response = await POST(request({ action: "release", artifactVersionId: "version-1", approvalId: "approval-1" }), { params: Promise.resolve({ artifactId: "artifact-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { releasable: false, reasonCode: "STALE_ARTIFACT_VERSION" } });
    expect(business.evaluateArtifactRelease).toHaveBeenCalledWith({ action: "release", artifactVersionId: "version-1", approvalId: "approval-1" }, expect.objectContaining({ scope }));
  });
});
