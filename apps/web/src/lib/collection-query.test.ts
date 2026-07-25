import { describe, expect, it } from "vitest";
import { buildCollectionQueryString } from "./collection-query";

describe("U062: collection-query unit tests", () => {
  it("builds clean query string for collection parameters", () => {
    const qs = buildCollectionQueryString({ first: 50, after: "cur1", query: "acme" });
    expect(qs).toBe("first=50&after=cur1&query=acme");
  });
});
