import { describe, expect, it } from "vitest";
import { ROLE_LANDINGS, getRoleLanding, isRouteAllowed } from "./route-responsibilities";

describe("U060: route-responsibilities unit tests", () => {
  it("defines exact landings for all ten BusinessRoles", () => {
    expect(ROLE_LANDINGS.ceo).toBe("/dashboard");
    expect(ROLE_LANDINGS.sales_manager).toBe("/deals");
    expect(ROLE_LANDINGS.account_manager).toBe("/home");
    expect(ROLE_LANDINGS.presales_engineer).toBe("/deals?view=presales");
    expect(ROLE_LANDINGS.solution_architect).toBe("/registry/rules");
    expect(ROLE_LANDINGS.finance_manager).toBe("/cfo/dashboard");
    expect(ROLE_LANDINGS.delivery_engineer).toBe("/delivery");
    expect(ROLE_LANDINGS.support_engineer).toBe("/support");
    expect(ROLE_LANDINGS.security_officer).toBe("/security");
    expect(ROLE_LANDINGS.system_admin).toBe("/operator/workflows");
  });

  it("getRoleLanding maps system_admin to /operator/workflows", () => {
    expect(getRoleLanding("system_admin")).toBe("/operator/workflows");
  });

  it("isRouteAllowed correctly enforces role access for restricted paths", () => {
    expect(isRouteAllowed("/operator/workflows", "system_admin")).toBe(true);
    expect(isRouteAllowed("/operator/workflows", "support_engineer")).toBe(false);
    expect(isRouteAllowed("/security", "security_officer")).toBe(true);
    expect(isRouteAllowed("/security", "sales_manager")).toBe(false);
  });
});
