import { beforeEach, describe, expect, it, vi } from "vitest";

import { __opportunityCursor } from "./opportunity-center";

describe("U043 opportunity keyset cursor", () => {
  beforeEach(() => {
    vi.stubEnv("CRM_CURSOR_SECRET", "u043-test-cursor-secret-that-is-at-least-thirty-two-bytes");
  });

  it("round-trips an opaque signed updatedAt DESC, id DESC cursor", () => {
    const boundary = {
      updatedAt: new Date("2026-07-24T01:02:03.456Z"),
      id: "opp-equal-timestamp-b",
    };
    const encoded = __opportunityCursor.encode(boundary, "project-a", {
      ownerAssignmentId: null,
      archived: false,
    });

    expect(encoded).not.toContain(boundary.id);
    expect(__opportunityCursor.decode(encoded, "project-a", {
      ownerAssignmentId: null,
      archived: false,
    })).toEqual(boundary);
  });

  it("rejects tampering, another project, and another filter binding", () => {
    const encoded = __opportunityCursor.encode(
      { updatedAt: new Date("2026-07-24T01:02:03.456Z"), id: "opp-2" },
      "project-a",
      { ownerAssignmentId: "assignment-a", archived: false },
    );

    expect(() => __opportunityCursor.decode(`${encoded.slice(0, -1)}x`, "project-a", {
      ownerAssignmentId: "assignment-a",
      archived: false,
    })).toThrow(/cursor/i);
    expect(() => __opportunityCursor.decode(encoded, "project-b", {
      ownerAssignmentId: "assignment-a",
      archived: false,
    })).toThrow(/cursor/i);
    expect(() => __opportunityCursor.decode(encoded, "project-a", {
      ownerAssignmentId: "assignment-b",
      archived: false,
    })).toThrow(/cursor/i);
  });

  it("builds the strict two-column continuation predicate without offset", () => {
    expect(
      __opportunityCursor.whereAfter({
        updatedAt: new Date("2026-07-24T01:02:03.456Z"),
        id: "opp-b",
      }),
    ).toEqual({
      OR: [
        { updatedAt: { lt: new Date("2026-07-24T01:02:03.456Z") } },
        {
          updatedAt: new Date("2026-07-24T01:02:03.456Z"),
          id: { lt: "opp-b" },
        },
      ],
    });
  });

  it("uses default 50 and caps first at 100", () => {
    expect(__opportunityCursor.pageSize(undefined)).toBe(50);
    expect(__opportunityCursor.pageSize(1)).toBe(1);
    expect(__opportunityCursor.pageSize(100)).toBe(100);
    expect(() => __opportunityCursor.pageSize(101)).toThrow(/100/);
    expect(() => __opportunityCursor.pageSize(0)).toThrow(/positive/i);
  });
});
