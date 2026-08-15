import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseSessionTtlSeconds,
  resolveCronCallConfig,
  shouldDisableTlsVerification,
} from "./cron-call-config.mjs";

describe("resolveCronCallConfig", () => {
  it("keeps the legacy local defaults", () => {
    assert.deepEqual(resolveCronCallConfig({}), {
      webContainer: "sangfor-production-web-1",
      postgresContainer: "sangfor-production-postgres-1",
      baseUrl: "https://aios.localhost",
    });
  });

  it("targets an explicitly configured production stack", () => {
    assert.deepEqual(
      resolveCronCallConfig({
        SANGFOR_WEB_CONTAINER: "sangfor-blro-web-1",
        SANGFOR_POSTGRES_CONTAINER: "sangfor-blro-postgres-1",
        SANGFOR_BASE_URL: "https://blro.alpines-goldeye.ts.net",
      }),
      {
        webContainer: "sangfor-blro-web-1",
        postgresContainer: "sangfor-blro-postgres-1",
        baseUrl: "https://blro.alpines-goldeye.ts.net",
      },
    );
  });
});

describe("parseSessionTtlSeconds", () => {
  it("uses the exact live user-session TTL", () => {
    assert.equal(parseSessionTtlSeconds("28800"), 28_800);
  });

  it("rejects an invalid live user-session TTL", () => {
    assert.throws(() => parseSessionTtlSeconds(""), /USER_JWT_TTL_SECONDS/u);
    assert.throws(() => parseSessionTtlSeconds("900.5"), /USER_JWT_TTL_SECONDS/u);
  });
});

describe("shouldDisableTlsVerification", () => {
  it("allows insecure TLS only for the legacy loopback endpoint", () => {
    assert.equal(shouldDisableTlsVerification("https://aios.localhost"), true);
    assert.equal(
      shouldDisableTlsVerification("https://blro.alpines-goldeye.ts.net"),
      false,
    );
  });
});
