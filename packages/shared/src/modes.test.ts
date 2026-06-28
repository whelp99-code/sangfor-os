import { describe, expect, it } from "vitest";

import {
  AI_EXECUTION_MODES,
  MODE_MATRIX,
  OPERATING_MODES,
  ROLE_MODES,
  UNSAFE_ACTIONS,
  getRoleModeEntry,
  isUnsafeAction,
  requiresApprovalForAction,
} from "./modes";

describe("mode matrix", () => {
  it("defines every required role, AI, and operating mode", () => {
    expect(ROLE_MODES).toEqual([
      "sales",
      "presales",
      "delivery",
      "support",
      "cfo",
      "operator",
      "security",
    ]);
    expect(AI_EXECUTION_MODES).toEqual([
      "draft",
      "review",
      "approve",
      "smoke",
      "full",
      "manual",
      "assisted",
      "autonomous",
      "color-agent-review",
    ]);
    expect(OPERATING_MODES).toEqual([
      "dev",
      "demo",
      "staging",
      "production",
      "mock-upstream",
      "real-upstream",
      "read-only",
      "write-enabled",
    ]);
  });

  it("requires approval for unsafe actions", () => {
    expect(UNSAFE_ACTIONS).toEqual([
      "send",
      "export",
      "share",
      "delete",
      "deploy",
      "real-upstream-write",
      "production-db-mutation",
      "release-tag",
    ]);
    expect(isUnsafeAction("send")).toBe(true);
    expect(isUnsafeAction("view-dashboard")).toBe(false);
    expect(requiresApprovalForAction("send")).toBe(true);
    expect(requiresApprovalForAction("view-dashboard")).toBe(false);
  });

  it("defines a role entry with dashboard, allowed actions, blocked actions, and evidence", () => {
    expect(MODE_MATRIX).toHaveLength(ROLE_MODES.length);
    expect(getRoleModeEntry("operator")).toMatchObject({
      role: "operator",
      dashboardPath: "/operator",
      evidenceVisible: true,
    });
    expect(getRoleModeEntry("security").blockedActions).toEqual(
      expect.arrayContaining(["deploy", "production-db-mutation", "release-tag"]),
    );
  });
});
