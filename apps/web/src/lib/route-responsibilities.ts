import { isBusinessRoleCode, type BusinessRole } from "@sangfor/auth";
import { BUSINESS_ROLE_DASHBOARD_LANDINGS } from "@sangfor/business";

export interface RouteResponsibility {
  readonly canonicalPath: string;
  readonly allowedRoles: readonly BusinessRole[];
  readonly navVisible: boolean;
  readonly isHub: boolean;
  readonly compatibilityRedirectFrom?: string;
}

export const ROLE_LANDINGS: Record<BusinessRole, string> = BUSINESS_ROLE_DASHBOARD_LANDINGS;

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

export function getRoleLanding(role: string): string | null {
  return isBusinessRoleCode(role) ? ROLE_LANDINGS[role] : null;
}

export function isRouteAllowed(path: string, role: string): boolean {
  if (!isBusinessRoleCode(role)) return false;
  const match = ROUTE_RESPONSIBILITIES.find((r) => r.canonicalPath === path || r.compatibilityRedirectFrom === path);
  if (!match) return true; // Unmapped paths default to allowed if authenticated
  return match.allowedRoles.includes(role);
}
