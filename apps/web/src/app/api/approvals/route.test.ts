import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  authSessionFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  userCompanyRoleFindMany: vi.fn(),
}));

vi.mock("@sangfor/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/db")>();
  return { ...actual, prisma: { ...actual.prisma,
    authSession: { findUnique: prismaMocks.authSessionFindUnique },
    user: { findUnique: prismaMocks.userFindUnique },
    userCompanyRole: { findMany: prismaMocks.userCompanyRoleFindMany },
  } };
});

const businessMocks = vi.hoisted(() => ({ decideApproval: vi.fn(), submitApprovalRequest: vi.fn() }));

vi.mock("@sangfor/business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/business")>();
  return { ...actual, decideApproval: businessMocks.decideApproval, submitApprovalRequest: businessMocks.submitApprovalRequest };
});

import { signSessionJwt } from "@sangfor/auth";
import { ApprovalKernelError } from "@sangfor/business";

import { INTERNAL_CONTEXT_HEADER, signInternalContext } from "@/lib/auth/persisted-session";

import { PATCH, POST } from "./route";

function validUserJwtEnv(): Record<string, string> {
  const secret = Buffer.alloc(32, 9).toString("base64url");
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    USER_JWT_ACTIVE_KID: "approvals-route-test-key-1",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "900",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [
        {
          kid: "approvals-route-test-key-1",
          state: "active",
          secretBase64Url: secret,
          activatedAt,
          demotedAt: null,
          verifyUntil: null,
          retiredAt: null,
        },
      ],
    }),
  };
}

const SESSION_SCOPE = { tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" };

function authedRequest(options: {
  method: "POST" | "PATCH";
  body?: unknown;
  mfaVerifiedAt?: Date | null;
  userId?: string;
  businessRole?: string;
} ) {
  const userId = options.userId ?? "user-1";
  const jti = `jti-${Math.random().toString(36).slice(2)}`;
  const token = signSessionJwt({ sub: userId, jti, ...SESSION_SCOPE, projectSlug: "demo", product: "portal", role: "operator" });
  const mfaVerifiedAt = options.mfaVerifiedAt === undefined ? new Date() : options.mfaVerifiedAt;

  prismaMocks.authSessionFindUnique.mockResolvedValueOnce({
    id: jti,
    userId,
    tenantId: SESSION_SCOPE.tenantId,
    companyId: SESSION_SCOPE.companyId,
    projectId: SESSION_SCOPE.projectId,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 900_000),
    revokedAt: null,
    mfaVerifiedAt,
    mfaMethod: mfaVerifiedAt ? "totp" : null,
  });
  prismaMocks.userFindUnique.mockResolvedValueOnce({ id: userId, status: "active", disabledAt: null });

  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (options.businessRole !== undefined) {
    prismaMocks.userCompanyRoleFindMany.mockResolvedValueOnce([
      {
        id: "ucr-test",
        userId,
        companyId: SESSION_SCOPE.companyId,
        role: options.businessRole,
        status: "active",
        validFrom: null,
        expiresAt: null,
        revokedAt: null,
      },
    ]);
    headers[INTERNAL_CONTEXT_HEADER] = signInternalContext({
      ok: true,
      sessionId: "jti-test",
      userId,
      tenantId: SESSION_SCOPE.tenantId,
      companyId: SESSION_SCOPE.companyId,
      projectId: SESSION_SCOPE.projectId,
      mfaVerifiedAt,
    });
  }

  return new Request("http://localhost/api/approvals", {
    method: options.method,
    headers,
    body: JSON.stringify(options.body ?? {}),
  });
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so an unconsumed `mockResolvedValueOnce` session queue from
  // a capability-denied test (account_manager short-circuits before the session resolver) cannot
  // leak into the next test and spuriously 401 an otherwise-valid caller.
  vi.resetAllMocks();
  vi.stubEnv("AUTH_BYPASS_ENABLED", "");
  vi.stubEnv("AUTH_PROFILE", "");
  for (const [key, value] of Object.entries(validUserJwtEnv())) vi.stubEnv(key, value);
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/approvals — canonical creation contract", () => {
  it("returns 401 with no session — AUTH_BYPASS_ENABLED does not create a canonical actor", async () => {
    vi.stubEnv("AUTH_BYPASS_ENABLED", "1");
    const request = new Request("http://localhost/api/approvals", { method: "POST", body: JSON.stringify({}) });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(businessMocks.submitApprovalRequest).not.toHaveBeenCalled();
  });

  it("rejects a body that supplies status or a readiness flag as an unknown key", async () => {
    const request = authedRequest({
      method: "POST",
      body: { action: "release", artifactVersionId: "v1", artifactHash: "h1", policyVersion: "p1", requiredQuorum: 2, status: "approved" },
    });
    const response = await POST(request);
    expect([400, 422]).toContain(response.status);
    expect(businessMocks.submitApprovalRequest).not.toHaveBeenCalled();
  });

  it("rejects an explicit foreign scope selector with 403", async () => {
    const request = authedRequest({
      method: "POST",
      body: { action: "release", artifactVersionId: "v1", artifactHash: "h1", policyVersion: "p1", requiredQuorum: 2, tenantId: "some-other-tenant" },
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("creates via the kernel with scope from AuthContext, not the request body", async () => {
    businessMocks.submitApprovalRequest.mockResolvedValueOnce({
      request: { id: "appr-1", status: "ready_for_human_approval", revision: 1 },
      validity: { state: "pending", requiredQuorum: 2, satisfiedQuorum: 0 },
    });
    const request = authedRequest({
      method: "POST",
      body: { action: "release", artifactVersionId: "v1", artifactHash: "h1", policyVersion: "p1", requiredQuorum: 2 },
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(businessMocks.submitApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ action: "release", artifactVersionId: "v1", requiredQuorum: 2 }),
      expect.objectContaining({ scope: SESSION_SCOPE }),
    );
  });

  it("maps kernel HASH_MISMATCH to 422", async () => {
    businessMocks.submitApprovalRequest.mockRejectedValueOnce(new ApprovalKernelError("HASH_MISMATCH", "hash mismatch"));
    const request = authedRequest({
      method: "POST",
      body: { action: "release", artifactVersionId: "v1", artifactHash: "wrong", policyVersion: "p1", requiredQuorum: 2 },
    });
    const response = await POST(request);
    expect(response.status).toBe(422);
  });
});

describe("PATCH /api/approvals — deprecated compatibility adapter", () => {
  it("denies (403) an account_manager caller — the same role.manage capability the canonical decisions route now also enforces", async () => {
    const request = authedRequest({
      method: "PATCH",
      businessRole: "account_manager",
      body: { approvalId: "appr-1", decision: "approve", expectedRevision: 1 },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ reason: "MISSING_PERMISSION" });
    expect(businessMocks.decideApproval).not.toHaveBeenCalled();
  });

  it("admits an eligible role.manage approver (security_officer) and reaches the kernel", async () => {
    businessMocks.decideApproval.mockResolvedValueOnce({
      outcome: "approved",
      request: { id: "appr-1", status: "approved", revision: 2 },
      decision: { id: "dec-1", sequence: 1, decision: "approve" },
      validity: { state: "valid", satisfiedQuorum: 1, requiredQuorum: 1 },
    });
    const request = authedRequest({
      method: "PATCH",
      businessRole: "security_officer",
      body: { approvalId: "appr-1", decision: "approve", expectedRevision: 1 },
    });
    const response = await PATCH(request);
    expect(response.status).toBe(200);
    expect(businessMocks.decideApproval).toHaveBeenCalledTimes(1);
  });

  it("emits a Deprecation header on every response, including errors", async () => {
    const request = authedRequest({ method: "PATCH", body: { approvalId: "appr-1", decision: "approve", expectedRevision: 1 } });
    businessMocks.decideApproval.mockRejectedValueOnce(new ApprovalKernelError("STALE_REVISION", "stale"));
    const response = await PATCH(request);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.status).toBe(409);
  });

  it("returns 401 with no session — the old one-click blind approval is gone", async () => {
    vi.stubEnv("AUTH_BYPASS_ENABLED", "1");
    const request = new Request("http://localhost/api/approvals", { method: "PATCH", body: JSON.stringify({ approvalId: "appr-1" }) });
    const response = await PATCH(request);
    expect(response.status).toBe(401);
    expect(businessMocks.decideApproval).not.toHaveBeenCalled();
  });

  it("rejects a body without expectedRevision (today's defect: approvalId alone used to be enough)", async () => {
    const request = authedRequest({ method: "PATCH", body: { approvalId: "appr-1", decision: "approve" } });
    const response = await PATCH(request);
    expect([400, 422]).toContain(response.status);
    expect(businessMocks.decideApproval).not.toHaveBeenCalled();
  });

  it("rejects a body-supplied actor field (actorId/approvedBy) — the caller's identity always comes from the session", async () => {
    const request = authedRequest({
      method: "PATCH",
      body: { approvalId: "appr-1", decision: "approve", expectedRevision: 1, approvedBy: "forged-actor" },
    });
    const response = await PATCH(request);
    expect([400, 422]).toContain(response.status);
    expect(businessMocks.decideApproval).not.toHaveBeenCalled();
  });

  it("still requires decision + expectedRevision + canonical AuthContext and delegates to the SAME kernel decideApproval used by the canonical route", async () => {
    businessMocks.decideApproval.mockResolvedValueOnce({
      outcome: "approved",
      request: { id: "appr-1", status: "approved", revision: 2 },
      decision: { id: "dec-1", sequence: 1, decision: "approve" },
      validity: { state: "valid", satisfiedQuorum: 1, requiredQuorum: 1 },
    });
    const request = authedRequest({ method: "PATCH", userId: "user-77", body: { approvalId: "appr-1", decision: "approve", expectedRevision: 1 } });
    const response = await PATCH(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(businessMocks.decideApproval).toHaveBeenCalledWith(
      { approvalId: "appr-1", decision: "approve", expectedRevision: 1, reason: undefined },
      expect.objectContaining({ userId: "user-77", scope: SESSION_SCOPE }),
    );
  });

  it("cannot bypass CAS via a stale/latest revision replay — the kernel's STALE_REVISION/TERMINAL_STATE surfaces as 409", async () => {
    businessMocks.decideApproval.mockRejectedValueOnce(new ApprovalKernelError("TERMINAL_STATE", "terminal"));
    const request = authedRequest({ method: "PATCH", body: { approvalId: "appr-1", decision: "approve", expectedRevision: 5 } });
    const response = await PATCH(request);
    expect(response.status).toBe(409);
    expect(response.headers.get("Deprecation")).toBe("true");
  });
});
