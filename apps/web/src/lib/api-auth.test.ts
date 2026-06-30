import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertApiAccess, isAuthBypassEnabled } from "./api-auth";

const ENV_KEY = "AUTH_BYPASS_ENABLED";

describe("isAuthBypassEnabled", () => {
  it("is true only for an explicit '1' flag", () => {
    expect(isAuthBypassEnabled({ [ENV_KEY]: "1" })).toBe(true);
  });

  it("treats absent / empty / other values as off", () => {
    expect(isAuthBypassEnabled({})).toBe(false);
    expect(isAuthBypassEnabled({ [ENV_KEY]: "" })).toBe(false);
    expect(isAuthBypassEnabled({ [ENV_KEY]: " " })).toBe(false);
    expect(isAuthBypassEnabled({ [ENV_KEY]: "0" })).toBe(false);
    expect(isAuthBypassEnabled({ [ENV_KEY]: "true" })).toBe(false);
  });
});

describe("assertApiAccess", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("passes (returns null) when bypass is explicitly enabled", () => {
    process.env[ENV_KEY] = "1";
    expect(assertApiAccess(new Request("http://localhost/api/tasks"))).toBeNull();
  });

  it("returns a 401 response when the flag is absent", async () => {
    const res = assertApiAccess(new Request("http://localhost/api/tasks"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    await expect(res!.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Authentication required",
    });
  });

  it("returns a 401 response when the flag is empty", () => {
    process.env[ENV_KEY] = "";
    const res = assertApiAccess(new Request("http://localhost/api/tasks"));
    expect(res?.status).toBe(401);
  });
});
