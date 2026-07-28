import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  authSessionUpdateMany: vi.fn(),
}));

vi.mock("@sangfor/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/db")>();
  return { ...actual, prisma: { ...actual.prisma,
    authSession: { updateMany: prismaMocks.authSessionUpdateMany },
  } };
});

import { createSessionToken } from "@/lib/auth/session";
import { POST } from "./route";

function validUserJwtEnv(): Record<string, string> {
  const secret = Buffer.alloc(32, 11).toString("base64url");
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    USER_JWT_ACTIVE_KID: "logout-test-key-1",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "900",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [
        {
          kid: "logout-test-key-1",
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

function logoutRequest(cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `session=${cookie}`);
  return new Request("http://localhost/api/auth/logout", { method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_BYPASS_ENABLED", "");
  vi.stubEnv("AUTH_PROFILE", "");
  stubValidUserJwtEnv();
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/logout", () => {
  it("returns 401 without a session (assertApiAccess guard, same as every other mutating route)", async () => {
    const response = await POST(logoutRequest());
    expect(response.status).toBe(401);
  });

  it("revokes the session, clears the cookie with Max-Age=0, and returns ok", async () => {
    const token = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    prismaMocks.authSessionUpdateMany.mockResolvedValueOnce({ count: 1 });

    const response = await POST(logoutRequest(token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/session=;/);
    expect(setCookie).toMatch(/Max-Age=0\b/);
    expect(prismaMocks.authSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: expect.any(String), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("is idempotent: a second logout with the same (already-revoked) token still succeeds and clears the cookie", async () => {
    const token = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "project-1",
      projectSlug: "demo-project",
    });

    prismaMocks.authSessionUpdateMany.mockResolvedValueOnce({ count: 1 });
    const first = await POST(logoutRequest(token));
    expect(first.status).toBe(200);

    prismaMocks.authSessionUpdateMany.mockResolvedValueOnce({ count: 0 });
    const second = await POST(logoutRequest(token));
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ ok: true });
    expect((second.headers.get("set-cookie") ?? "")).toMatch(/Max-Age=0\b/);
  });

  it("rejects the mock session token (assertApiAccess never treats it as a real session outside local_mock)", async () => {
    const response = await POST(logoutRequest("mock.session"));
    expect(response.status).toBe(401);
    expect(prismaMocks.authSessionUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a garbage/tampered token before ever attempting a DB revoke", async () => {
    const token = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    const [header, payload] = token.split(".");
    const response = await POST(logoutRequest(`${header}.${payload}.forged`));
    expect(response.status).toBe(401);
    expect(prismaMocks.authSessionUpdateMany).not.toHaveBeenCalled();
  });
});
