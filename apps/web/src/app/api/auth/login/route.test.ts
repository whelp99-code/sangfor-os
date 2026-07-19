import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/project-scope", () => ({
  resolveDefaultProjectScope: vi.fn().mockResolvedValue(null),
}));

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

describe("POST /api/auth/login fail-closed profile", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_DEMO_PASSWORD", "");
    vi.stubEnv("AUTH_PROFILE", "");
    vi.stubEnv("JWT_SECRET", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns exact 503 without a cookie when production lacks JWT_SECRET", async () => {
    // Given
    vi.stubEnv("NODE_ENV", "production");

    // When
    const response = await POST(loginRequest("203.0.113.1"));

    // Then
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AUTH_CONFIGURATION_UNAVAILABLE",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns exact 503 when development omits the local_mock profile", async () => {
    // Given
    vi.stubEnv("NODE_ENV", "development");

    // When
    const response = await POST(loginRequest("203.0.113.2"));

    // Then
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AUTH_CONFIGURATION_UNAVAILABLE",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("issues only the fixed fixture identity for explicit local_mock development", async () => {
    // Given
    vi.stubEnv("AUTH_PROFILE", "local_mock");
    vi.stubEnv("NODE_ENV", "development");

    // When
    const response = await POST(loginRequest("203.0.113.3"));

    // Then
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      token: "mock.session",
      authMode: "mock",
      user: { email: "operator@demo.local", role: "admin" },
    });
    expect(response.headers.get("set-cookie")).toContain("session=mock.session");
  });

  it("rejects local_mock in production without issuing a cookie", async () => {
    // Given
    vi.stubEnv("AUTH_PROFILE", "local_mock");
    vi.stubEnv("NODE_ENV", "production");

    // When
    const response = await POST(loginRequest("203.0.113.4"));

    // Then
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AUTH_CONFIGURATION_UNAVAILABLE",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
