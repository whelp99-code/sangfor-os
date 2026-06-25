import { describe, expect, it } from "vitest";

import { canAccessRoute, getVisibleNavItems } from "./permissions";

describe("permissions", () => {
  it("hides approval nav for member role", () => {
    const items = getVisibleNavItems("member");
    expect(items.some((item) => item.href === "/approvals")).toBe(false);
  });

  it("shows approval nav for owner role", () => {
    const items = getVisibleNavItems("owner");
    expect(items.some((item) => item.href === "/approvals")).toBe(true);
  });

  it("blocks approval route for member", () => {
    expect(canAccessRoute("/approvals", "member")).toBe(false);
    expect(canAccessRoute("/approvals", "owner")).toBe(true);
  });
});
