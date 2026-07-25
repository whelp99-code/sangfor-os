import type { BusinessRole } from "@sangfor/auth";

export interface RouteResponsibility {
  readonly canonicalPath: string;
  readonly allowedRoles: readonly BusinessRole[];
  readonly navVisible: boolean;
  readonly isHub: boolean;
  readonly compatibilityRedirectFrom?: string;
}

export const ROLE_LANDINGS: Record<BusinessRole, string> = {
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
};

export const ROUTE_RESPONSIBILITIES: readonly RouteResponsibility[] = [
  { canonicalPath: "/home", allowedRoles: ["ceo", "sales_manager", "account_manager", "presales_engineer", "solution_architect", "finance_manager", "delivery_engineer", "support_engineer", "security_officer", "system_admin"], navVisible: true, isHub: false },
  { canonicalPath: "/dashboard", allowedRoles: ["ceo", "sales_manager", "finance_manager", "system_admin"], navVisible: true, isHub: true },
  { canonicalPath: "/deals", allowedRoles: ["ceo", "sales_manager", "account_manager", "presales_engineer", "solution_architect", "system_admin"], navVisible: true, isHub: true },
  { canonicalPath: "/deals?view=presales", allowedRoles: ["presales_engineer", "solution_architect", "system_admin"], navVisible: false, isHub: false, compatibilityRedirectFrom: "/presales" },
  { canonicalPath: "/cfo/dashboard", allowedRoles: ["ceo", "finance_manager", "system_admin"], navVisible: true, isHub: true },
  { canonicalPath: "/delivery", allowedRoles: ["ceo", "delivery_engineer", "system_admin"], navVisible: true, isHub: true },
  { canonicalPath: "/support", allowedRoles: ["ceo", "support_engineer", "system_admin"], navVisible: true, isHub: true },
  { canonicalPath: "/security", allowedRoles: ["ceo", "security_officer", "system_admin"], navVisible: true, isHub: true },
  { canonicalPath: "/operator/workflows", allowedRoles: ["system_admin"], navVisible: true, isHub: true, compatibilityRedirectFrom: "/operator" },
  { canonicalPath: "/ai-team", allowedRoles: ["ceo", "system_admin"], navVisible: true, isHub: true, compatibilityRedirectFrom: "/agents" },
  { canonicalPath: "/registry/rules", allowedRoles: ["solution_architect", "system_admin"], navVisible: true, isHub: true },
];

export function getRoleLanding(role: BusinessRole): string {
  return ROLE_LANDINGS[role] ?? "/home";
}

export function isRouteAllowed(path: string, role: BusinessRole): boolean {
  const match = ROUTE_RESPONSIBILITIES.find((r) => r.canonicalPath === path || r.compatibilityRedirectFrom === path);
  if (!match) return true; // Unmapped paths default to allowed if authenticated
  return match.allowedRoles.includes(role);
}
