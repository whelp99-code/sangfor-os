import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractSessionToken: vi.fn(() => "token" as string | null),
  getWebSessionJwtConfig: vi.fn(() => ({}) as unknown),
  verifySessionJwt: vi.fn(() => ({ jti: "session-1" }) as unknown),
  evaluatePersistedSessionFromClaims: vi.fn(async () => ({
    ok: true,
    userId: "user-1",
    tenantId: "tenant-1",
    companyId: "company-1",
    projectId: "project-1",
    mfaVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  }) as unknown),
}));

vi.mock("@sangfor/auth", () => ({
  PRIVILEGED_MFA_MAX_AGE_SECONDS: 900,
  verifySessionJwt: mocks.verifySessionJwt,
}));
vi.mock("@/lib/auth/config", () => ({ getWebSessionJwtConfig: mocks.getWebSessionJwtConfig }));
vi.mock("@/lib/auth/session", () => ({ extractSessionToken: mocks.extractSessionToken }));
vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromClaims: mocks.evaluatePersistedSessionFromClaims,
}));

import { resolveApprovalKernelCaller } from "./resolve-caller";

const request = () => new Request("http://localhost/api/workflow-runs", { method: "POST" });

describe("resolveApprovalKernelCaller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractSessionToken.mockReturnValue("token");
    mocks.getWebSessionJwtConfig.mockReturnValue({});
    mocks.verifySessionJwt.mockReturnValue({ jti: "session-1" });
    mocks.evaluatePersistedSessionFromClaims.mockResolvedValue({
      ok: true,
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      mfaVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("derives the caller scope from the persisted session, never from the request", async () => {
    const resolved = await resolveApprovalKernelCaller(request());
    expect(resolved).not.toBeInstanceOf(Response);
    expect(resolved).toEqual({
      userId: "user-1",
      sessionId: "session-1",
      scope: { tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" },
      mfaVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("returns 401 when no session token is present", async () => {
    mocks.extractSessionToken.mockReturnValue(null);
    const resolved = await resolveApprovalKernelCaller(request());
    expect(resolved).toBeInstanceOf(Response);
    expect((resolved as Response).status).toBe(401);
    expect(mocks.verifySessionJwt).not.toHaveBeenCalled();
  });

  it("fails closed with 401 when the JWT configuration is unavailable", async () => {
    mocks.getWebSessionJwtConfig.mockImplementation(() => {
      throw new Error("AUTH_CONFIGURATION_UNAVAILABLE");
    });
    const resolved = await resolveApprovalKernelCaller(request());
    expect(resolved).toBeInstanceOf(Response);
    expect((resolved as Response).status).toBe(401);
  });

  it("returns 401 when the session JWT does not verify", async () => {
    mocks.verifySessionJwt.mockReturnValue(null);
    const resolved = await resolveApprovalKernelCaller(request());
    expect(resolved).toBeInstanceOf(Response);
    expect((resolved as Response).status).toBe(401);
  });

  it("returns 403 for MFA_REQUIRED and MFA_STALE, 401 for other session failures", async () => {
    for (const reason of ["MFA_REQUIRED", "MFA_STALE"]) {
      mocks.evaluatePersistedSessionFromClaims.mockResolvedValue({ ok: false, reason });
      const resolved = await resolveApprovalKernelCaller(request());
      expect((resolved as Response).status).toBe(403);
    }
    mocks.evaluatePersistedSessionFromClaims.mockResolvedValue({ ok: false, reason: "SESSION_REVOKED" });
    const resolved = await resolveApprovalKernelCaller(request());
    expect((resolved as Response).status).toBe(401);
  });
});
