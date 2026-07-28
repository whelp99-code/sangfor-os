import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/project-scope", () => ({
  resolveDefaultProjectScope: vi.fn().mockResolvedValue(null),
}));

const credentialMocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/auth/password-credential", () => ({
  authenticatePasswordCredential: credentialMocks.authenticate,
}));

const prismaMocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  projectFindUnique: vi.fn(),
  projectMemberFindFirst: vi.fn(),
  userCompanyRoleFindFirst: vi.fn(),
  authSessionCreate: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    user: { findUnique: prismaMocks.userFindUnique },
    project: { findUnique: prismaMocks.projectFindUnique },
    projectMember: { findFirst: prismaMocks.projectMemberFindFirst },
    userCompanyRole: { findFirst: prismaMocks.userCompanyRoleFindFirst },
    authSession: { create: prismaMocks.authSessionCreate },
  },
}));

import { resolveDefaultProjectScope } from "@/lib/project-scope";
import { POST } from "./route";

function loginRequest(ip: string, email = "attacker@example.com"): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ email, password: "irrelevant" }),
  });
}

function validUserJwtEnv(): Record<string, string> {
  const secret = Buffer.alloc(32, 8).toString("base64url");
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    USER_JWT_ACTIVE_KID: "login-test-key-1",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "900",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [
        {
          kid: "login-test-key-1",
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

describe("POST /api/auth/login fail-closed profile", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_DEMO_PASSWORD", "");
    vi.stubEnv("AUTH_PROFILE", "");
    vi.stubEnv("USER_JWT_ACTIVE_KID", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns exact 503 without a cookie when production lacks the USER_JWT_* keyring", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(loginRequest("203.0.113.1"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AUTH_CONFIGURATION_UNAVAILABLE",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns exact 503 when development omits the local_mock profile", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await POST(loginRequest("203.0.113.2"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AUTH_CONFIGURATION_UNAVAILABLE",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("issues only the fixed fixture identity for explicit local_mock development", async () => {
    vi.stubEnv("AUTH_PROFILE", "local_mock");
    vi.stubEnv("NODE_ENV", "development");

    const response = await POST(loginRequest("203.0.113.3"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      token: "mock.session",
      authMode: "mock",
      user: { email: "operator@demo.local", role: "admin" },
    });
    expect(response.headers.get("set-cookie")).toContain("session=mock.session");
  });

  it("rejects local_mock in production without issuing a cookie", async () => {
    vi.stubEnv("AUTH_PROFILE", "local_mock");
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(loginRequest("203.0.113.4"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AUTH_CONFIGURATION_UNAVAILABLE",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/auth/login with a configured USER_JWT_* keyring", () => {
  const ACTIVE_USER = { id: "user-1", status: "active", disabledAt: null };
  const PROJECT = { id: "project-1", companyId: "company-1", company: { tenantId: "tenant-1" } };

  beforeEach(() => {
    vi.stubEnv("AUTH_PROFILE", "");
    for (const [key, value] of Object.entries(validUserJwtEnv())) vi.stubEnv(key, value);
    prismaMocks.userFindUnique.mockReset();
    prismaMocks.projectFindUnique.mockReset();
    prismaMocks.projectMemberFindFirst.mockReset().mockResolvedValue({ id: "membership-1" });
    prismaMocks.userCompanyRoleFindFirst.mockReset().mockResolvedValue({ id: "role-1" });
    prismaMocks.authSessionCreate.mockReset().mockResolvedValue({});
    credentialMocks.authenticate.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires AUTH_DEMO_PASSWORD before accepting any credentials", async () => {
    vi.stubEnv("AUTH_DEMO_PASSWORD", "");

    const response = await POST(loginRequest("203.0.113.10"));

    expect(response.status).toBe(503);
  });

  it("uses a per-user credential and forbids shared demo-password auth in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SANGFOR_PROCESS_PROFILE", "production");
    vi.stubEnv("AUTH_DEMO_PASSWORD", "");
    credentialMocks.authenticate.mockResolvedValueOnce(true);
    vi.mocked(resolveDefaultProjectScope).mockResolvedValueOnce({ projectId: "project-1", projectSlug: "demo-project" });
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    prismaMocks.projectFindUnique.mockResolvedValueOnce(PROJECT);

    const response = await POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.14" },
      body: JSON.stringify({ email: "ACTIVE@EXAMPLE.COM", password: "per-user-password-value" }),
    }));

    expect(response.status).toBe(200);
    expect(credentialMocks.authenticate).toHaveBeenCalledWith("active@example.com", "per-user-password-value");
  });

  it("issues a canonical 3-segment session JWT with a cookie bounded to the token TTL, not 7 days — for an existing, explicitly active user", async () => {
    vi.stubEnv("AUTH_DEMO_PASSWORD", "correct-horse-battery");
    vi.mocked(resolveDefaultProjectScope).mockResolvedValueOnce({
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    prismaMocks.userFindUnique.mockResolvedValueOnce(ACTIVE_USER);
    prismaMocks.projectFindUnique.mockResolvedValueOnce(PROJECT);

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
        body: JSON.stringify({ email: "active@example.com", password: "correct-horse-battery" }),
      }),
    );

    expect(response.status).toBe(200);
    const body: { token: string; authMode: string; user: { email: string; role: string } } = await response.json();
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.authMode).toBe("jwt");
    expect(body.user).toMatchObject({ email: "active@example.com", role: "operator" });
    expect(prismaMocks.authSessionCreate).toHaveBeenCalledTimes(1);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`session=${body.token}`);
    expect(setCookie).toMatch(/Max-Age=900\b/);
    expect(setCookie).not.toMatch(/Max-Age=604800\b/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("rejects an arbitrary/unknown email with valid credentials — never auto-upserts it into an enabled user (U014/SEC-01)", async () => {
    vi.stubEnv("AUTH_DEMO_PASSWORD", "correct-horse-battery");
    vi.mocked(resolveDefaultProjectScope).mockResolvedValueOnce({
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    prismaMocks.userFindUnique.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.12" },
        body: JSON.stringify({ email: "attacker@example.com", password: "correct-horse-battery" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid credentials" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(prismaMocks.authSessionCreate).not.toHaveBeenCalled();
  });

  it.each([[null], ["legacy_pending"], ["disabled"]])(
    "rejects a %s user with valid credentials — no session even with the right password",
    async (status) => {
      vi.stubEnv("AUTH_DEMO_PASSWORD", "correct-horse-battery");
      vi.mocked(resolveDefaultProjectScope).mockResolvedValueOnce({
        projectId: "project-1",
        projectSlug: "demo-project",
      });
      prismaMocks.userFindUnique.mockResolvedValueOnce({
        id: "user-legacy",
        status,
        disabledAt: status === "disabled" ? new Date() : null,
      });

      const response = await POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.13" },
          body: JSON.stringify({ email: "legacy@example.com", password: "correct-horse-battery" }),
        }),
      );

      expect(response.status).toBe(401);
      expect(prismaMocks.authSessionCreate).not.toHaveBeenCalled();
    },
  );
});
