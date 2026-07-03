import { describe, expect, it } from "vitest";

import { formatKRWShort } from "./format-krw";

describe("formatKRWShort", () => {
  it("compacts to 억 with one decimal by default", () => {
    expect(formatKRWShort(420_000_000)).toBe("4.2억");
  });

  it("honors the eokDigits precision", () => {
    expect(formatKRWShort(126_000_000, 2)).toBe("1.26억");
  });

  it("compacts to 만 units", () => {
    expect(formatKRWShort(1_234_000)).toBe(`${(123).toLocaleString("ko-KR")}만`);
  });

  it("returns grouped value below 만", () => {
    expect(formatKRWShort(9_999)).toBe((9_999).toLocaleString("ko-KR"));
  });
});
