import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionToken, verifySessionToken } from "./session";

const SECRET_KEY = "JWT_SECRET";
const originalSecret = process.env[SECRET_KEY];

afterEach(() => {
  if (originalSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = originalSecret;
});

describe("verifySessionToken — mock tokens", () => {
  it("accepts mock tokens only while auth is unconfigured (dev/demo)", () => {
    delete process.env[SECRET_KEY];
    expect(verifySessionToken("mock.session")?.role).toBe("admin");
  });

  it("rejects mock tokens once a real secret is configured", () => {
    process.env[SECRET_KEY] = "test-secret-at-least-16-chars";
    expect(verifySessionToken("mock.session")).toBeNull();
    expect(verifySessionToken("mock.anything-else")).toBeNull();
  });
});

describe("verifySessionToken — signed tokens", () => {
  beforeEach(() => {
    process.env[SECRET_KEY] = "test-secret-at-least-16-chars";
  });

  it("round-trips a token it signed itself", () => {
    const token = createSessionToken({ id: "u1", email: "u@test.local", role: "operator" });
    const user = verifySessionToken(token);
    expect(user?.id).toBe("u1");
    expect(user?.role).toBe("operator");
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken({ id: "u1", email: "u@test.local", role: "operator" });
    const [body] = token.split(".");
    expect(verifySessionToken(`${body}.forged-signature`)).toBeNull();
  });
});
