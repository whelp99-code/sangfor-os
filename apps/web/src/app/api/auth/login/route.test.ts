import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/project-scope", () => ({
  resolveDefaultProjectScope: vi.fn().mockResolvedValue(null),
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
  beforeEach(() => {
    vi.stubEnv("AUTH_PROFILE", "");
    for (const [key, value] of Object.entries(validUserJwtEnv())) vi.stubEnv(key, value);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires AUTH_DEMO_PASSWORD before accepting any credentials", async () => {
    vi.stubEnv("AUTH_DEMO_PASSWORD", "");

    const response = await POST(loginRequest("203.0.113.10"));

    expect(response.status).toBe(503);
  });

  it("issues a canonical 3-segment session JWT with a cookie bounded to the token TTL, not 7 days", async () => {
    vi.stubEnv("AUTH_DEMO_PASSWORD", "correct-horse-battery");
    vi.mocked(resolveDefaultProjectScope).mockResolvedValueOnce({
      projectId: "project-1",
      projectSlug: "demo-project",
    });

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
        body: JSON.stringify({ email: "user@example.com", password: "correct-horse-battery" }),
      }),
    );

    expect(response.status).toBe(200);
    const body: { token: string; authMode: string; user: { email: string; role: string } } = await response.json();
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.authMode).toBe("jwt");
    expect(body.user).toMatchObject({ email: "user@example.com", role: "operator" });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`session=${body.token}`);
    expect(setCookie).toMatch(/Max-Age=900\b/);
    expect(setCookie).not.toMatch(/Max-Age=604800\b/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });
});
