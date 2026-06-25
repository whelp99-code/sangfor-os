import { describe, expect, it } from "vitest";

import { canAccessRoute, getVisibleNavItems } from "@/lib/permissions";

describe("Phase 11 permission checks", () => {
  it("hides approvals from member role", () => {
    const memberNav = getVisibleNavItems("member");
    expect(memberNav.some((item) => item.href === "/approvals")).toBe(false);
  });

  it("allows owner to access approvals", () => {
    expect(canAccessRoute("/approvals", "owner")).toBe(true);
  });

  it("blocks member from approvals route", () => {
    expect(canAccessRoute("/approvals", "member")).toBe(false);
  });
});
