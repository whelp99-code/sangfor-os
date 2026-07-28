import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  projectFindUnique: vi.fn(),
  projectMemberFindFirst: vi.fn(),
  userCompanyRoleFindFirst: vi.fn(),
  authSessionCreate: vi.fn(),
  authSessionFindUnique: vi.fn(),
  authSessionUpdateMany: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    user: { findUnique: prismaMocks.userFindUnique },
    project: { findUnique: prismaMocks.projectFindUnique },
    projectMember: { findFirst: prismaMocks.projectMemberFindFirst },
    userCompanyRole: { findFirst: prismaMocks.userCompanyRoleFindFirst },
    authSession: {
      create: prismaMocks.authSessionCreate,
      findUnique: prismaMocks.authSessionFindUnique,
      updateMany: prismaMocks.authSessionUpdateMany,
    },
  },
}));

import { verifySessionJwt } from "@sangfor/auth";

import {
  createPersistedSession,
  evaluatePersistedSessionFromRequest,
  resolveActiveLocalPrincipal,
  revokeSession,
  signInternalContext,
  verifyInternalContextHeader,
} from "./persisted-session";
import { getWebSessionJwtConfig } from "./config";

function validUserJwtEnv(): Record<string, string> {
  const secret = Buffer.alloc(32, 5).toString("base64url");
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    USER_JWT_ACTIVE_KID: "persisted-session-test-key-1",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "900",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [
        {
          kid: "persisted-session-test-key-1",
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

function stubValidUserJwtEnv() {
  for (const [key, value] of Object.entries(validUserJwtEnv())) vi.stubEnv(key, value);
}

function requestWithCookie(token: string): Request {
  return new Request("http://localhost/api/private", { headers: { cookie: `session=${token}` } });
}

const ACTIVE_USER = { id: "user-1", status: "active", disabledAt: null };
const PROJECT = { id: "project-1", companyId: "company-1", company: { tenantId: "tenant-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.projectMemberFindFirst.mockResolvedValue({ id: "membership-1" });
  prismaMocks.userCompanyRoleFindFirst.mockResolvedValue({ id: "role-1" });
  stubValidUserJwtEnv();
});

afterEach(() => vi.unstubAllEnvs());

describe("resolveActiveLocalPrincipal", () => {
  it("resolves an explicitly active user scoped to the given project", async () => {
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    prismaMocks.projectFindUnique.mockResolvedValueOnce(PROJECT);

    const result = await resolveActiveLocalPrincipal("operator@example.com", "project-1");

    expect(result).toEqual({ userId: "user-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" });
  });

  it("returns null for an arbitrary email with no matching user row (never auto-upserts)", async () => {
    prismaMocks.userFindUnique.mockResolvedValueOnce(null);

    const result = await resolveActiveLocalPrincipal("nobody@example.com", "project-1");

    expect(result).toBeNull();
    expect(prismaMocks.projectFindUnique).not.toHaveBeenCalled();
  });

  it.each([[null], ["legacy_pending"]])("returns null for a legacy %s user even with a matching row", async (status) => {
    prismaMocks.userFindUnique.mockResolvedValueOnce({ id: "user-2", status, disabledAt: null });

    const result = await resolveActiveLocalPrincipal("legacy@example.com", "project-1");

    expect(result).toBeNull();
  });

  it("returns null for a disabled user", async () => {
    prismaMocks.userFindUnique.mockResolvedValueOnce({ id: "user-3", status: "disabled", disabledAt: new Date() });

    const result = await resolveActiveLocalPrincipal("disabled@example.com", "project-1");

    expect(result).toBeNull();
  });

  it("returns null when the project has no resolvable company/tenant chain", async () => {
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    prismaMocks.projectFindUnique.mockResolvedValueOnce({ id: "project-1", companyId: null, company: null });

    const result = await resolveActiveLocalPrincipal("operator@example.com", "project-1");

    expect(result).toBeNull();
  });

  it("returns null without active project and company authority", async () => {
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    prismaMocks.projectFindUnique.mockResolvedValueOnce(PROJECT);
    prismaMocks.projectMemberFindFirst.mockResolvedValueOnce(null);

    await expect(resolveActiveLocalPrincipal("operator@example.com", "project-1")).resolves.toBeNull();
  });
});

describe("createPersistedSession", () => {
  it("creates the AuthSession row before minting a token bound to the same jti (failure-atomic)", async () => {
    prismaMocks.authSessionCreate.mockResolvedValueOnce({});

    const result = await createPersistedSession({
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      projectSlug: "demo-project",
      role: "operator",
    });

    expect(prismaMocks.authSessionCreate).toHaveBeenCalledTimes(1);
    const createArgs = prismaMocks.authSessionCreate.mock.calls[0]![0];
    expect(createArgs.data.id).toBe(result.jti);
    expect(createArgs.data.userId).toBe("user-1");

    const claims = verifySessionJwt(result.token, getWebSessionJwtConfig());
    expect(claims?.jti).toBe(result.jti);
    expect(claims?.sub).toBe("user-1");
    expect(claims?.tenantId).toBe("tenant-1");
    expect(claims?.companyId).toBe("company-1");
    expect(claims?.projectId).toBe("project-1");
  });

  it("never mints a token when the DB insert fails", async () => {
    prismaMocks.authSessionCreate.mockRejectedValueOnce(new Error("insert failed"));

    await expect(
      createPersistedSession({
        userId: "user-1",
        tenantId: "tenant-1",
        companyId: "company-1",
        projectId: "project-1",
        projectSlug: "demo-project",
        role: "operator",
      }),
    ).rejects.toThrow("insert failed");
  });
});

describe("evaluatePersistedSessionFromRequest", () => {
  it("denies with NO_SESSION when there is no token at all", async () => {
    const result = await evaluatePersistedSessionFromRequest(new Request("http://localhost/api/private"));
    expect(result).toEqual({ ok: false, reason: "NO_SESSION" });
  });

  it("denies with NO_SESSION for a syntactically valid but unsigned/tampered token", async () => {
    const result = await evaluatePersistedSessionFromRequest(requestWithCookie("not.a.validtoken"));
    expect(result).toEqual({ ok: false, reason: "NO_SESSION" });
    expect(prismaMocks.authSessionFindUnique).not.toHaveBeenCalled();
  });

  it("denies a cryptographically valid token that has no DB session row", async () => {
    prismaMocks.authSessionCreate.mockResolvedValueOnce({});
    const { token } = await createPersistedSession({
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      projectSlug: "demo-project",
      role: "operator",
    });
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce(null);

    const result = await evaluatePersistedSessionFromRequest(requestWithCookie(token));

    expect(result).toEqual({ ok: false, reason: "NO_SESSION" });
  });

  it("denies a revoked session", async () => {
    prismaMocks.authSessionCreate.mockResolvedValueOnce({});
    const { token, jti } = await createPersistedSession({
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      projectSlug: "demo-project",
      role: "operator",
    });
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce({
      id: jti,
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
      revokedAt: new Date(),
      mfaVerifiedAt: null,
      mfaMethod: null,
    });
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);

    const result = await evaluatePersistedSessionFromRequest(requestWithCookie(token));

    expect(result).toEqual({ ok: false, reason: "REVOKED" });
  });

  it("denies a session whose user is disabled — the still-valid JWT is denied on the next request", async () => {
    prismaMocks.authSessionCreate.mockResolvedValueOnce({});
    const { token, jti } = await createPersistedSession({
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      projectSlug: "demo-project",
      role: "operator",
    });
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce({
      id: jti,
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
      revokedAt: null,
      mfaVerifiedAt: null,
      mfaMethod: null,
    });
    prismaMocks.userFindUnique.mockResolvedValueOnce({ id: "user-1", status: "disabled", disabledAt: new Date() });

    const result = await evaluatePersistedSessionFromRequest(requestWithCookie(token));

    expect(result).toEqual({ ok: false, reason: "USER_NOT_ACTIVE" });
  });

  it("succeeds for an active session/user pair", async () => {
    prismaMocks.authSessionCreate.mockResolvedValueOnce({});
    const { token, jti } = await createPersistedSession({
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      projectSlug: "demo-project",
      role: "operator",
    });
    prismaMocks.authSessionFindUnique.mockResolvedValueOnce({
      id: jti,
      userId: "user-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
      revokedAt: null,
      mfaVerifiedAt: null,
      mfaMethod: null,
    });
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);

    const result = await evaluatePersistedSessionFromRequest(requestWithCookie(token));

    expect(result).toMatchObject({ ok: true, userId: "user-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" });
  });
});

describe("revokeSession", () => {
  it("is idempotent: the second logout for the same jti still succeeds", async () => {
    prismaMocks.authSessionUpdateMany.mockResolvedValueOnce({ count: 1 });
    const first = await revokeSession("jti-1");
    expect(first).toEqual({ revoked: true });

    prismaMocks.authSessionUpdateMany.mockResolvedValueOnce({ count: 0 });
    const second = await revokeSession("jti-1");
    expect(second).toEqual({ revoked: false });
  });
});

describe("internal context signing", () => {
  const evaluation = {
    ok: true as const,
    userId: "user-1",
    tenantId: "tenant-1",
    companyId: "company-1",
    projectId: "project-1",
    mfaVerifiedAt: null,
  };

  it("round-trips a freshly signed context", () => {
    const header = signInternalContext(evaluation);
    const verified = verifyInternalContextHeader(header);
    expect(verified).toMatchObject({ userId: "user-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" });
  });

  it("rejects a missing header", () => {
    expect(verifyInternalContextHeader(null)).toBeNull();
    expect(verifyInternalContextHeader(undefined)).toBeNull();
  });

  it("rejects a client-forged/tampered header", () => {
    const header = signInternalContext(evaluation);
    const [segment] = header.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...evaluation, userId: "attacker", iat: Math.floor(Date.now() / 1000) })).toString("base64url");
    expect(verifyInternalContextHeader(`${forgedPayload}.forged-signature`)).toBeNull();
    expect(verifyInternalContextHeader(`${segment}.forged-signature`)).toBeNull();
  });

  it("rejects a stale header past its own freshness window", () => {
    vi.useFakeTimers();
    try {
      const header = signInternalContext(evaluation);
      vi.advanceTimersByTime(60_000);
      expect(verifyInternalContextHeader(header)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
