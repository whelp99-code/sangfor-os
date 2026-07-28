import { getBusinessRoleDashboard, type BusinessRoleDashboardInput } from "./business-role-dashboard";

/**
 * @deprecated Legacy compatibility adapter for U063 — delegates directly to getBusinessRoleDashboard.
 */
export async function getRoleDashboardData(input: BusinessRoleDashboardInput) {
  return getBusinessRoleDashboard(input);
}
