import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSessionToken,
  getSessionFromRequest,
  SessionAuthenticationError,
  verifySessionToken,
} from "./session";

const SECRET_KEY = "JWT_SECRET";
const PROFILE_KEY = "AUTH_PROFILE";
const NODE_ENV_KEY = "NODE_ENV";
afterEach(() => vi.unstubAllEnvs());

describe("verifySessionToken — mock tokens", () => {
  it("rejects mock tokens when the local_mock profile is absent in development", () => {
    // Given
    vi.stubEnv(SECRET_KEY, "");
    vi.stubEnv(PROFILE_KEY, "");
    vi.stubEnv(NODE_ENV_KEY, "development");

    // When
    const user = verifySessionToken("mock.session");

    // Then
    expect(user).toBeNull();
  });

  it("accepts the fixed mock principal under the explicit local_mock test profile", () => {
    // Given
    vi.stubEnv(SECRET_KEY, "");
    vi.stubEnv(PROFILE_KEY, "local_mock");
    vi.stubEnv(NODE_ENV_KEY, "test");

    // When
    const user = verifySessionToken("mock.session");

    // Then
    expect(user).toMatchObject({
      id: "mock-user",
      email: "operator@demo.local",
      role: "admin",
    });
  });

  it("rejects mock tokens under the local_mock profile in production", () => {
    // Given
    vi.stubEnv(SECRET_KEY, "");
    vi.stubEnv(PROFILE_KEY, "local_mock");
    vi.stubEnv(NODE_ENV_KEY, "production");

    // When
    const user = verifySessionToken("mock.session");

    // Then
    expect(user).toBeNull();
  });

  it("rejects mock tokens once a real secret is configured", () => {
    // Given
    vi.stubEnv(SECRET_KEY, "test-secret-at-least-16-chars");

    // When / Then
    expect(verifySessionToken("mock.session")).toBeNull();
    expect(verifySessionToken("mock.anything-else")).toBeNull();
  });
});

describe("getSessionFromRequest", () => {
  it("does not augment an unverified request with the mock user", () => {
    // Given
    vi.stubEnv(SECRET_KEY, "");
    vi.stubEnv(PROFILE_KEY, "");
    vi.stubEnv(NODE_ENV_KEY, "development");
    const request = new Request("http://localhost/api/private");

    // When
    const readSession = () => getSessionFromRequest(request);

    // Then
    expect(readSession).toThrowError(SessionAuthenticationError);
  });
});

describe("verifySessionToken — signed tokens", () => {
  beforeEach(() => {
    vi.stubEnv(SECRET_KEY, "test-secret-at-least-16-chars");
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
    expect(user?.role).toBe("operator");
    expect(user?.projectId).toBe("project-1");
    expect(user?.projectSlug).toBe("demo-project");
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken({
      id: "u1",
      email: "u@test.local",
      role: "operator",
      projectId: "project-1",
      projectSlug: "demo-project",
    });
    const [body] = token.split(".");
    expect(verifySessionToken(`${body}.forged-signature`)).toBeNull();
  });

  it("rejects a validly signed legacy token without project scope", () => {
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
