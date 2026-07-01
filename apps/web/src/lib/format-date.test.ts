import { describe, expect, it } from "vitest";

import { formatDate, formatDateInput } from "./format-date";

describe("formatDate", () => {
  it("formats a Date as YYYY-MM-DD", () => {
    expect(formatDate(new Date("2026-02-03T09:30:00Z"))).toBe("2026-02-03");
  });

  it("formats an ISO string as YYYY-MM-DD", () => {
    expect(formatDate("2026-12-25T00:00:00Z")).toBe("2026-12-25");
  });

  it("returns the default empty fallback for nullish values", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
  });

  it("returns a custom fallback for nullish values", () => {
    expect(formatDate(null, "—")).toBe("—");
    expect(formatDate(undefined, "미정")).toBe("미정");
  });

  it("returns the fallback for unparsable input", () => {
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate("not-a-date", "미정")).toBe("미정");
  });
});

describe("formatDateInput", () => {
  it("always falls back to an empty string", () => {
    expect(formatDateInput(null)).toBe("");
    expect(formatDateInput("not-a-date")).toBe("");
  });

  it("formats a valid value as YYYY-MM-DD", () => {
    expect(formatDateInput("2026-06-30T12:00:00Z")).toBe("2026-06-30");
  });
});
