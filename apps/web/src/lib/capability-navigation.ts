import type { BusinessRole } from "@sangfor/auth";
import { ROUTE_RESPONSIBILITIES, isRouteAllowed } from "./route-responsibilities";

export function getVisibleNavRoutes(role: BusinessRole) {
  return ROUTE_RESPONSIBILITIES.filter((r) => r.navVisible && r.allowedRoles.includes(role));
}

export function canAccessPath(path: string, role: BusinessRole): boolean {
  return isRouteAllowed(path, role);
}
