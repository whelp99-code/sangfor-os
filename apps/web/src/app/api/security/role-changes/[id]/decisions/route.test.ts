import { beforeEach, describe, expect, it, vi } from "vitest";

const decide = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ token: vi.fn(), config: vi.fn(), session: vi.fn() }));
vi.mock("@sangfor/business", () => ({ RoleChangeError: class RoleChangeError extends Error {}, decideRoleChange: decide }));
vi.mock("@/lib/api-auth", () => ({ assertApiAccess: () => null }));
vi.mock("@/lib/auth/session", () => ({ extractSessionToken: auth.token }));
vi.mock("@/lib/auth/config", () => ({ getWebSessionJwtConfig: auth.config }));
vi.mock("@/lib/auth/persisted-session", () => ({ evaluatePersistedSessionFromClaims: auth.session }));
vi.mock("@sangfor/auth", () => ({ PRIVILEGED_MFA_MAX_AGE_SECONDS: 300, verifySessionJwt: () => ({ jti: "session" }) }));

import { POST } from "./route";

describe("POST /api/security/role-changes/:id/decisions", () => {
  beforeEach(() => { vi.clearAllMocks(); auth.token.mockReturnValue(null); });
  it("requires authentication and never trusts a body actor", async () => {
    const response = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ approvalId: "a", decision: "approve", expectedRevision: 1, actorId: "forged" }) }), { params: Promise.resolve({ id: "role-change" }) });
    expect(response.status).toBe(401);
    expect(decide).not.toHaveBeenCalled();
  });

  it("rejects forged body authority and sends only the path-bound decision contract to the service", async () => {
    auth.token.mockReturnValue("signed"); auth.config.mockReturnValue({});
    auth.session.mockResolvedValue({ ok: true, userId: "approver", tenantId: "tenant", companyId: "company", projectId: "project", mfaVerifiedAt: new Date() });
    const params = { params: Promise.resolve({ id: "role-change" }) };
    expect((await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ approvalId: "approval", decision: "approve", expectedRevision: 1, actorId: "forged" }) }), params)).status).toBe(400);
    decide.mockResolvedValue({ outcome: "recorded_nonterminal", request: { id: "role-change", status: "pending_approval", revision: 0 }, approval: { id: "approval", status: "ready_for_human_approval", revision: 2 } });
    const response = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ approvalId: "approval", decision: "approve", expectedRevision: 1 }) }), params);
    expect(response.status).toBe(200);
    expect(decide).toHaveBeenCalledWith({ roleChangeRequestId: "role-change", approvalId: "approval", decision: "approve", expectedRevision: 1, reason: undefined }, expect.objectContaining({ userId: "approver" }));
  });
});
