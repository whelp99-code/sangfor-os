import type { BusinessRole } from "@sangfor/auth";

export const ROLE_LANDING_PATHS: Readonly<Record<BusinessRole, string>> = Object.freeze({
  ceo: "/dashboard",
  sales_manager: "/deals",
  account_manager: "/home",
  presales_engineer: "/deals?view=presales",
  solution_architect: "/registry/rules",
  finance_manager: "/cfo/dashboard",
  delivery_engineer: "/delivery",
  support_engineer: "/support",
  security_officer: "/security",
  system_admin: "/operator/workflows",
});

export function roleLandingPath(role: BusinessRole): string {
  return ROLE_LANDING_PATHS[role];
}
