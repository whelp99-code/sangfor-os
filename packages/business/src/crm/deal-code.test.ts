import { describe, it, expect } from "vitest";
import { formatDealCode } from "./deal-code";

describe("formatDealCode", () => {
  it("zero-pads to 4 digits", () => {
    expect(formatDealCode(2026, 42)).toBe("PRJ-2026-0042");
  });
  it("pads single digit", () => {
    expect(formatDealCode(2026, 7)).toBe("PRJ-2026-0007");
  });
  it("keeps 4-digit seq as-is", () => {
    expect(formatDealCode(2026, 1234)).toBe("PRJ-2026-1234");
  });
  it("does not truncate 5-digit seq", () => {
    expect(formatDealCode(2026, 12345)).toBe("PRJ-2026-12345");
  });
});
