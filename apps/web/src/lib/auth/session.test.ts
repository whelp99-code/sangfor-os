import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSessionToken,
  getSessionFromRequest,
  SessionAuthenticationError,
  verifySessionToken,
} from "./session";

const PROFILE_KEY = "AUTH_PROFILE";
const NODE_ENV_KEY = "NODE_ENV";

function validUserJwtEnv(): Record<string, string> {
  const secret = Buffer.alloc(32, 9).toString("base64url");
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    USER_JWT_ACTIVE_KID: "web-test-key-1",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "900",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [
        {
          kid: "web-test-key-1",
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

// Forces the "unconfigured" state regardless of any ambient USER_JWT_* default
// (e.g. the local-only keyring in the repo root's gitignored .env, present so
// unrelated test files across the app can mint tokens without their own setup).
function stubUnconfiguredUserJwtEnv() {
  vi.stubEnv("USER_JWT_ACTIVE_KID", "");
}

afterEach(() => vi.unstubAllEnvs());

describe("verifySessionToken — mock tokens", () => {
  it("rejects mock tokens when the local_mock profile is absent in development", () => {
    stubUnconfiguredUserJwtEnv();
    vi.stubEnv(PROFILE_KEY, "");
    vi.stubEnv(NODE_ENV_KEY, "development");

    expect(verifySessionToken("mock.session")).toBeNull();
  });

  it("accepts the fixed mock principal under the explicit local_mock test profile", () => {
    stubUnconfiguredUserJwtEnv();
    vi.stubEnv(PROFILE_KEY, "local_mock");
    vi.stubEnv(NODE_ENV_KEY, "test");

    const user = verifySessionToken("mock.session");

    expect(user).toMatchObject({
      id: "mock-user",
      email: "operator@demo.local",
      role: "admin",
    });
  });

  it("rejects mock tokens under the local_mock profile in production", () => {
    stubUnconfiguredUserJwtEnv();
    vi.stubEnv(PROFILE_KEY, "local_mock");
    vi.stubEnv(NODE_ENV_KEY, "production");

    expect(verifySessionToken("mock.session")).toBeNull();
  });

  it("rejects mock tokens once a real USER_JWT_* keyring is configured", () => {
    stubValidUserJwtEnv();

    expect(verifySessionToken("mock.session")).toBeNull();
    expect(verifySessionToken("mock.anything-else")).toBeNull();
  });
});

describe("getSessionFromRequest", () => {
  it("does not augment an unverified request with the mock user", () => {
    stubUnconfiguredUserJwtEnv();
    vi.stubEnv(PROFILE_KEY, "");
    vi.stubEnv(NODE_ENV_KEY, "development");
    const request = new Request("http://localhost/api/private");

    expect(() => getSessionFromRequest(request)).toThrowError(SessionAuthenticationError);
  });
});

describe("verifySessionToken — signed tokens", () => {
  beforeEach(() => stubValidUserJwtEnv());

  it("produces a canonical 3-segment compact JWT (GREEN counterpart of the U013 RED baseline)", () => {
    const token = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    expect(token.split(".")).toHaveLength(3);
  });

  it("round-trips a token it signed itself", () => {
    const token = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    const user = verifySessionToken(token);
    expect(user?.id).toBe("u1");
    expect(user?.projectId).toBe("project-1");
    expect(user?.projectSlug).toBe("demo-project");
    expect(user?.role).toBe("operator");
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    const [header, payload] = token.split(".");
    expect(verifySessionToken(`${header}.${payload}.forged-signature-segment`)).toBeNull();
  });

  it("rejects a legacy 2-segment token", () => {
    const token = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    const [header, payload] = token.split(".");
    expect(verifySessionToken(`${header}.${payload}`)).toBeNull();
  });

  it("rejects a validly signed token without project scope", () => {
    const legacyToken = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "",
      projectSlug: "",
    });

    expect(verifySessionToken(legacyToken)).toBeNull();
  });
});
