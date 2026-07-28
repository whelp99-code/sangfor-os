import { describe, expect, it } from "vitest";
import { getVisibleNavRoutes, canAccessPath } from "./capability-navigation";

describe("U063: capability-navigation unit tests", () => {
  it("getVisibleNavRoutes filters navVisible routes by role", () => {
    const adminRoutes = getVisibleNavRoutes("system_admin");
    expect(adminRoutes.some((r) => r.canonicalPath === "/operator/workflows")).toBe(true);

    const supportRoutes = getVisibleNavRoutes("support_engineer");
    expect(supportRoutes.some((r) => r.canonicalPath === "/operator/workflows")).toBe(false);
  });

  it("canAccessPath evaluates route access correctly", () => {
    expect(canAccessPath("/security", "security_officer")).toBe(true);
    expect(canAccessPath("/security", "sales_manager")).toBe(false);
  });
});
