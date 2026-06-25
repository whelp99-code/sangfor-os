import { MOCK_USER, PORTAL_NAV, type NavItem } from "@/lib/portal-config";

/**
 * Purpose:
 * - Filter shell navigation by mock role until Phase 4 auth lands.
 *
 * Failure Points:
 * - Empty roles array on an item hides it for everyone — use undefined for public items.
 */
export function getVisibleNavItems(role: string = MOCK_USER.role): NavItem[] {
  return PORTAL_NAV.filter(
    (item) => !item.roles?.length || item.roles.includes(role),
  );
}

export function canAccessRoute(pathname: string, role: string = MOCK_USER.role): boolean {
  const item = PORTAL_NAV.find((nav) => pathname.startsWith(nav.href));
  if (!item) return true;
  return !item.roles?.length || item.roles.includes(role);
}
