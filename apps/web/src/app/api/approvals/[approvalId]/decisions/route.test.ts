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

const businessMocks = vi.hoisted(() => ({ decideApproval: vi.fn() }));

// Keep the REAL ApprovalKernelError class (the route does `error instanceof ApprovalKernelError`)
// — only the kernel entrypoint itself is faked, so this test exercises the route's own auth/
// contract-shape/HTTP-envelope logic without re-running the full kernel (that is
// approval-kernel.test.ts's/approval-kernel.integration.test.ts's job).
vi.mock("@sangfor/business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/business")>();
  return { ...actual, decideApproval: businessMocks.decideApproval };
});

import { signSessionJwt } from "@sangfor/auth";
import { ApprovalKernelError } from "@sangfor/business";

import { INTERNAL_CONTEXT_HEADER, signInternalContext } from "@/lib/auth/persisted-session";

import { POST } from "./route";

function validUserJwtEnv(): Record<string, string> {
  const secret = Buffer.alloc(32, 7).toString("base64url");
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    USER_JWT_ACTIVE_KID: "decisions-test-key-1",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "28800",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [
        {
          kid: "decisions-test-key-1",
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

/** Mints a real, cryptographically valid session JWT and queues the exact DB rows
 * `evaluatePersistedSessionFromClaims` needs to accept it — the SAME canonical DB-backed
 * AuthContext resolver path a real request takes, never a bypass.
 *
 * When `businessRole` is given, this also attaches a signed internal-context header (the same
 * envelope the Web Proxy attaches after its own DB-backed session check) and queues the matching
 * `UserCompanyRole` row, so `assertBusinessCapability` — a no-op without that header, per its own
 * direct-call-unit-test premise — actually runs its DB-driven role/permission check instead of
 * silently passing through. */
function authedRequest(options: {
  body?: unknown;
  mfaVerifiedAt?: Date | null;
  userId?: string;
  approvalId?: string;
  sessionOverrides?: Record<string, unknown>;
  businessRole?: string;
} = {}) {
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
    ...options.sessionOverrides,
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

  return new Request(`http://localhost/api/approvals/${options.approvalId ?? "appr-1"}/decisions`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? { decision: "approve", expectedRevision: 1 }),
  });
}

function paramsFor(approvalId: string) {
  return { params: Promise.resolve({ approvalId }) };
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so unconsumed `mockResolvedValueOnce` queues never leak
  // across tests: a capability-denied path (e.g. account_manager) short-circuits before
  // resolveDecisionCaller, leaving its queued session rows unconsumed — those must not bleed into
  // the next test's resolver and spuriously 401 an otherwise-eligible caller.
  vi.resetAllMocks();
  vi.stubEnv("AUTH_BYPASS_ENABLED", "");
  vi.stubEnv("AUTH_PROFILE", "");
  for (const [key, value] of Object.entries(validUserJwtEnv())) vi.stubEnv(key, value);
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/approvals/[approvalId]/decisions", () => {
  it("returns 401 with no session at all — AUTH_BYPASS_ENABLED does not create a decision actor", async () => {
    vi.stubEnv("AUTH_BYPASS_ENABLED", "1");
    const request = new Request("http://localhost/api/approvals/appr-1/decisions", {
      method: "POST",
      body: JSON.stringify({ decision: "approve", expectedRevision: 1 }),
    });
    const response = await POST(request, paramsFor("appr-1"));
    expect(response.status).toBe(401);
    expect(businessMocks.decideApproval).not.toHaveBeenCalled();
  });

  it("returns 403 when the session has no fresh MFA evidence", async () => {
    const request = authedRequest({ mfaVerifiedAt: null });
    const response = await POST(request, paramsFor("appr-1"));
    expect(response.status).toBe(403);
    expect(businessMocks.decideApproval).not.toHaveBeenCalled();
  });

  it("rejects a body-supplied actor/status/quorum field as an unknown key (400/422) and calls the kernel with nothing", async () => {
    const request = authedRequest({ body: { decision: "approve", expectedRevision: 1, actorId: "forged-actor" } });
    const response = await POST(request, paramsFor("appr-1"));
    expect([400, 422]).toContain(response.status);
    expect(businessMocks.decideApproval).not.toHaveBeenCalled();
  });

  it("rejects an explicit foreign company scope selector in the body with 403", async () => {
    const request = authedRequest({ body: { decision: "approve", expectedRevision: 1, companyId: "some-other-company" } });
    const response = await POST(request, paramsFor("appr-1"));
    expect(response.status).toBe(403);
    expect(businessMocks.decideApproval).not.toHaveBeenCalled();
  });

  it("passes the server-resolved AuthContext (never a body actor) to the kernel, with approvalId from the URL", async () => {
    businessMocks.decideApproval.mockResolvedValueOnce({
      outcome: "approved",
      request: { id: "appr-1", status: "approved", revision: 2 },
      decision: { id: "dec-1", sequence: 1, decision: "approve" },
      validity: { state: "valid", satisfiedQuorum: 1, requiredQuorum: 1 },
    });
    const request = authedRequest({ approvalId: "appr-1", userId: "user-42", body: { decision: "approve", expectedRevision: 1 } });

    const response = await POST(request, paramsFor("appr-1"));
    expect(response.status).toBe(200);
    expect(businessMocks.decideApproval).toHaveBeenCalledWith(
      { approvalId: "appr-1", decision: "approve", expectedRevision: 1, reason: undefined },
      expect.objectContaining({ userId: "user-42", scope: SESSION_SCOPE }),
    );
  });

  it("maps ApprovalKernelError codes onto their stable HTTP status", async () => {
    businessMocks.decideApproval.mockRejectedValueOnce(new ApprovalKernelError("UNKNOWN_DECISION", "unknown decision"));
    const response = await POST(authedRequest({ body: { decision: "super-approve", expectedRevision: 1 } }), paramsFor("appr-1"));
    expect(response.status).toBe(422);
  });

  it("maps NOT_FOUND (opaque foreign/nonexistent approvalId) to 404", async () => {
    businessMocks.decideApproval.mockRejectedValueOnce(new ApprovalKernelError("NOT_FOUND", "not found"));
    const response = await POST(authedRequest(), paramsFor("does-not-exist"));
    expect(response.status).toBe(404);
  });

  it("maps STALE_REVISION/TERMINAL_STATE to 409", async () => {
    businessMocks.decideApproval.mockRejectedValueOnce(new ApprovalKernelError("TERMINAL_STATE", "terminal"));
    const response = await POST(authedRequest(), paramsFor("appr-1"));
    expect(response.status).toBe(409);
  });

  it("denies (403) an account_manager caller — the canonical path must not be weaker than the deprecated PATCH sibling it replaces", async () => {
    const request = authedRequest({ businessRole: "account_manager" });
    const response = await POST(request, paramsFor("appr-1"));
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
    const request = authedRequest({ businessRole: "security_officer" });
    const response = await POST(request, paramsFor("appr-1"));
    expect(response.status).toBe(200);
    expect(businessMocks.decideApproval).toHaveBeenCalledTimes(1);
  });

  it("an under-quorum approve response reports the nonterminal outcome, never a false approved", async () => {
    businessMocks.decideApproval.mockResolvedValueOnce({
      outcome: "recorded_nonterminal",
      request: { id: "appr-1", status: "ready_for_human_approval", revision: 2 },
      decision: { id: "dec-1", sequence: 1, decision: "approve" },
      validity: { state: "pending", satisfiedQuorum: 1, requiredQuorum: 2 },
    });
    const response = await POST(authedRequest(), paramsFor("appr-1"));
    const payload = await response.json();
    expect(payload.data.outcome).toBe("recorded_nonterminal");
    expect(payload.data.approval.status).not.toBe("approved");
  });
});
