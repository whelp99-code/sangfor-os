import { describe, expect, it } from "vitest";

import { parsePortalEnv, requireInfraEnv } from "./env";

describe("parsePortalEnv", () => {
  it("accepts valid optional URLs", () => {
    const env = parsePortalEnv({
      DATABASE_URL: "postgresql://ai_portal:ai_portal@localhost:5434/ai_automation_portal",
      REDIS_URL: "redis://localhost:6380",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });

    expect(env.DATABASE_URL).toContain("postgresql://");
    expect(env.REDIS_URL).toContain("redis://");
  });

  it("rejects malformed DATABASE_URL", () => {
    expect(() =>
      parsePortalEnv({ DATABASE_URL: "not-a-url" }),
    ).toThrow();
  });
});

describe("requireInfraEnv", () => {
  it("requires both DATABASE_URL and REDIS_URL", () => {
    expect(() => requireInfraEnv({})).toThrow();
    expect(() =>
      requireInfraEnv({
        DATABASE_URL:
          "postgresql://ai_portal:ai_portal@localhost:5434/ai_automation_portal",
      }),
    ).toThrow();
  });
});
