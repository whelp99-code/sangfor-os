import { afterEach, describe, expect, it } from "vitest";

import { isApmTestRouteAllowed, isSentryConfigured } from "./sentry";

describe("sentry observability gates", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("isSentryConfigured is false when DSN unset", () => {
    delete process.env.SENTRY_DSN;
    expect(isSentryConfigured()).toBe(false);
  });

  it("isSentryConfigured is true when DSN set", () => {
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    expect(isSentryConfigured()).toBe(true);
  });

  it("apm test route disabled without flags", () => {
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    delete process.env.APM_TEST_ROUTE_ENABLED;
    expect(isApmTestRouteAllowed()).toBe(false);
  });

  it("apm test route enabled for staging with flags", () => {
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";
    process.env.APM_TEST_ROUTE_ENABLED = "1";
    process.env.SENTRY_ENVIRONMENT = "staging";
    expect(isApmTestRouteAllowed()).toBe(true);
  });
});
