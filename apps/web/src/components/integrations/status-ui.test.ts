import { describe, expect, it } from "vitest";

import { STATUS_META, normalizeStatus } from "./status-ui";

describe("normalizeStatus", () => {
  it("passes through known statuses", () => {
    expect(normalizeStatus("healthy")).toBe("healthy");
    expect(normalizeStatus("degraded")).toBe("degraded");
    expect(normalizeStatus("unreachable")).toBe("unreachable");
    expect(normalizeStatus("unknown")).toBe("unknown");
  });

  it("falls back to 'unknown' for unrecognized values", () => {
    expect(normalizeStatus("ok")).toBe("unknown");
    expect(normalizeStatus("")).toBe("unknown");
    expect(normalizeStatus("error")).toBe("unknown");
  });
});

describe("STATUS_META", () => {
  it("defines color + icon + label for every status (never color-only)", () => {
    for (const key of ["healthy", "degraded", "unreachable", "unknown"] as const) {
      const meta = STATUS_META[key];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.Icon).toBeDefined();
      expect(meta.dot).toContain("bg-");
      expect(meta.pill).toMatch(/border/);
    }
  });
});
