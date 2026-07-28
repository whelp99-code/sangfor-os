import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ token: vi.fn(), config: vi.fn(), session: vi.fn() }));
vi.mock("@sangfor/business", () => ({ RoleChangeError: class RoleChangeError extends Error {}, createRoleChangeRequest: create }));
vi.mock("@/lib/api-auth", () => ({ assertApiAccess: () => null }));
vi.mock("@/lib/auth/session", () => ({ extractSessionToken: auth.token }));
vi.mock("@/lib/auth/config", () => ({ getWebSessionJwtConfig: auth.config }));
vi.mock("@/lib/auth/persisted-session", () => ({ evaluatePersistedSessionFromClaims: auth.session }));
vi.mock("@sangfor/auth", () => ({ PRIVILEGED_MFA_MAX_AGE_SECONDS: 300, verifySessionJwt: () => ({ jti: "session" }) }));

import { POST } from "./route";

describe("POST /api/security/role-changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.token.mockReturnValue(null);
  });

  it("requires server authentication before accepting any body authority", async () => {
    const response = await POST(new Request("http://test/api/security/role-changes", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects missing idempotency, unknown body authority, and accepts an exact server-derived request", async () => {
    auth.token.mockReturnValue("signed");
    auth.config.mockReturnValue({});
    auth.session.mockResolvedValue({ ok: true, userId: "actor", tenantId: "tenant", companyId: "company", projectId: "project", mfaVerifiedAt: new Date() });
    const base = { targetMembershipId: "membership", toRole: "security_officer", reason: "need review", expectedMembershipRevision: 0 };
    expect((await POST(new Request("http://test", { method: "POST", body: JSON.stringify(base) }))).status).toBe(400);
    expect((await POST(new Request("http://test", { method: "POST", headers: { "idempotency-key": "u024-route-test-key" }, body: JSON.stringify({ ...base, companyId: "forged" }) }))).status).toBe(400);
    create.mockResolvedValue({ request: { id: "role-change", status: "pending_approval", revision: 0, approvalRequestId: "approval" }, idempotent: false });
    const response = await POST(new Request("http://test", { method: "POST", headers: { "idempotency-key": "u024-route-test-key" }, body: JSON.stringify(base) }));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ ...base, idempotencyKey: "u024-route-test-key" }), expect.objectContaining({ userId: "actor" }));
  });
});
