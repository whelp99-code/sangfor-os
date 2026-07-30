import { describe, expect, it } from "vitest";

import { isUpstreamUnreachable } from "./upstream-error";

/** What fetch actually throws when the upstream is not listening. */
function fetchFailed() {
  const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3502"), { code: "ECONNREFUSED" });
  const aggregate = Object.assign(new AggregateError([inner], ""), { code: "ECONNREFUSED" });
  return Object.assign(new TypeError("fetch failed"), { cause: aggregate });
}

describe("isUpstreamUnreachable", () => {
  it("finds the code nested under cause and under AggregateError.errors", () => {
    expect(isUpstreamUnreachable(fetchFailed())).toBe(true);
    expect(isUpstreamUnreachable(Object.assign(new Error("x"), { code: "ENOTFOUND" }))).toBe(true);
    expect(isUpstreamUnreachable({ cause: { errors: [{ code: "ETIMEDOUT" }] } })).toBe(true);
  });

  it("does not claim unrelated failures", () => {
    expect(isUpstreamUnreachable(new Error("malformed catalog payload"))).toBe(false);
    expect(isUpstreamUnreachable({ code: "ERR_INVALID_ARG_TYPE" })).toBe(false);
    expect(isUpstreamUnreachable(null)).toBe(false);
    expect(isUpstreamUnreachable("ECONNREFUSED")).toBe(false);
  });

  it("terminates on a cyclic cause chain", () => {
    const a: Record<string, unknown> = { code: "ERR_OTHER" };
    const b: Record<string, unknown> = { cause: a };
    a.cause = b;
    expect(isUpstreamUnreachable(a)).toBe(false);
  });
});
