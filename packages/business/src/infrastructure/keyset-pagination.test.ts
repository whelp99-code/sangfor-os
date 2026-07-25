import { describe, expect, it } from "vitest";
import { encodeCursor, decodeCursor, parseKeysetParams, KeysetPaginationError } from "./keyset-pagination";

describe("U062: keyset-pagination unit tests", () => {
  it("encodes and decodes valid cursor deterministically", () => {
    const cursor = encodeCursor("deals", "d1", "2026-07-25T00:00:00.000Z");
    expect(cursor).toBeDefined();
    const decoded = decodeCursor("deals", cursor);
    expect(decoded.id).toBe("d1");
    expect(decoded.sortValue).toBe("2026-07-25T00:00:00.000Z");
  });

  it("throws cursor_context_mismatch for collection name mismatch", () => {
    const cursor = encodeCursor("deals", "d1", "100");
    expect(() => decodeCursor("customers", cursor)).toThrow(KeysetPaginationError);
  });

  it("throws INVALID_CURSOR_PAIR when both after and before specified", () => {
    expect(() => parseKeysetParams({ after: "cur1", before: "cur2" })).toThrow(KeysetPaginationError);
  });

  it("bounds first parameter between 1 and maxFirst", () => {
    expect(parseKeysetParams({ first: 150 }).first).toBe(100);
    expect(parseKeysetParams({ first: -5 }).first).toBe(1);
  });
});
