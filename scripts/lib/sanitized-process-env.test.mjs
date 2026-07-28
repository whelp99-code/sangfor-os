import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PARENT_PASSTHROUGH_KEYS,
  ambientForbiddenKeysInChild,
  envKeySet,
  makeSanitizedProcessEnv,
} from "./sanitized-process-env.mjs";

describe("sanitized-process-env", () => {
  it("starts empty and only passes allowlist", () => {
    const parent = {
      PATH: "/usr/bin",
      HOME: "/home/u",
      USER: "u",
      DATABASE_URL: "postgres://evil",
      NODE_OPTIONS: "--inspect",
      HTTP_PROXY: "http://proxy",
      HTTPS_PROXY: "http://proxy",
      ALL_PROXY: "socks5://proxy",
      NO_PROXY: "*",
      NEXT_PUBLIC_FOO: "x",
      TASK_RUN_ID: "r1",
      ALIAS_X: "y",
      SECRET_TOKEN: "s",
      PORT: "3000",
      API_PORT: "3200",
      CI: "true",
      RANDOM_APP_KEY: "nope",
    };
    const child = makeSanitizedProcessEnv({ parentEnv: parent, lane: "generic" });
    assert.equal(child.PATH, "/usr/bin");
    assert.equal(child.HOME, "/home/u");
    assert.equal(child.CI, "true");
    assert.equal(child.DATABASE_URL, undefined);
    assert.equal(child.NODE_OPTIONS, undefined);
    assert.equal(child.HTTP_PROXY, undefined);
    assert.equal(child.NEXT_PUBLIC_FOO, undefined);
    assert.equal(child.TASK_RUN_ID, undefined);
    assert.equal(child.PORT, undefined);
    assert.equal(child.RANDOM_APP_KEY, undefined);
    assert.equal(ambientForbiddenKeysInChild(parent).length, 0);
  });

  it("install/build lanes only add NODE_ENV and NEXT_TELEMETRY_DISABLED", () => {
    const child = makeSanitizedProcessEnv({
      parentEnv: { PATH: "/bin" },
      lane: "build",
    });
    assert.equal(child.NODE_ENV, "production");
    assert.equal(child.NEXT_TELEMETRY_DISABLED, "1");
    assert.deepEqual(
      envKeySet(child).filter((k) => !PARENT_PASSTHROUGH_KEYS.includes(k)),
      ["NEXT_TELEMETRY_DISABLED", "NODE_ENV"],
    );
  });

  it("explicit runtime additions are allowed", () => {
    const child = makeSanitizedProcessEnv({
      parentEnv: { PATH: "/bin" },
      lane: "runtime",
      explicit: {
        DATABASE_URL: "postgresql://127.0.0.1:1/db",
        PORT: "3111",
        API_PORT: "3222",
        TASK_RUN_ID: "run-1",
      },
    });
    assert.equal(child.DATABASE_URL, "postgresql://127.0.0.1:1/db");
    assert.equal(child.PORT, "3111");
  });

  it("rejects empty explicit value", () => {
    assert.throws(
      () =>
        makeSanitizedProcessEnv({
          parentEnv: { PATH: "/bin" },
          explicit: { FOO: null },
        }),
      /empty explicit/,
    );
  });

  it("omits undefined parent keys", () => {
    const child = makeSanitizedProcessEnv({
      parentEnv: { PATH: "/bin" },
      lane: "generic",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(child, "HOME"), false);
  });
});
