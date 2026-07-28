/** U066 authoritative 56-entry UX route inventory. */

export const VIEWPORTS = [
  { label: "mobile", width: 375, height: 812 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1280, height: 900 },
] as const;

export type Viewport = (typeof VIEWPORTS)[number];

export const ALL_ROLES = [
  "ceo",
  "sales_manager",
  "account_manager",
  "presales_engineer",
  "solution_architect",
  "finance_manager",
  "delivery_engineer",
  "support_engineer",
  "security_officer",
  "system_admin",
] as const;

export type BusinessRole = (typeof ALL_ROLES)[number];
export type AuthProfile = BusinessRole | "anonymous" | "all";
export type TestTag = "B" | "L" | "S" | "C" | "P" | "A" | "D" | "R" | "F" | "V" | "W" | "Q";

export type RouteCase = {
  id: string;
  path: string;
  auth: AuthProfile;
  expectedRoute: string;
  tags: readonly TestTag[];
  fixtureKey?: string;
};

export const ROLE_LANDING_MAP: Readonly<Record<BusinessRole, string>> = {
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

export const ROUTE_CASES: readonly RouteCase[] = [
  { id: "S01", path: "/", auth: "all", expectedRoute: "role-dependent", tags: ["B", "L", "S"] },
  { id: "S02", path: "/login", auth: "anonymous", expectedRoute: "/login", tags: ["B", "S", "P"] },
  { id: "S03", path: "/home", auth: "account_manager", expectedRoute: "/home", tags: ["B", "S", "P"] },
  { id: "S04", path: "/dashboard", auth: "ceo", expectedRoute: "/dashboard", tags: ["B", "S", "P"] },
  { id: "S05", path: "/dashboard/roi", auth: "ceo", expectedRoute: "/dashboard/roi", tags: ["B", "S", "P"] },
  { id: "S06", path: "/deals", auth: "sales_manager", expectedRoute: "/deals", tags: ["B", "S", "C", "P"] },
  { id: "S07", path: "/deals?view=presales", auth: "presales_engineer", expectedRoute: "/deals?view=presales", tags: ["B", "S", "C", "P", "L"] },
  { id: "S08", path: "/sales", auth: "sales_manager", expectedRoute: "/sales", tags: ["B", "S", "P"] },
  { id: "S09", path: "/customers", auth: "account_manager", expectedRoute: "/customers", tags: ["B", "S", "C", "P"] },
  { id: "S10", path: "/partners", auth: "account_manager", expectedRoute: "/partners", tags: ["B", "S", "C", "P"] },
  { id: "S11", path: "/contacts", auth: "account_manager", expectedRoute: "/contacts", tags: ["B", "S", "C", "P"] },
  { id: "S12", path: "/approvals", auth: "ceo", expectedRoute: "/approvals", tags: ["B", "S", "C", "P"] },
  { id: "S13", path: "/inbox", auth: "account_manager", expectedRoute: "/inbox", tags: ["B", "S", "C", "P"] },
  { id: "S14", path: "/tasks", auth: "account_manager", expectedRoute: "/tasks", tags: ["B", "S", "C", "P", "F"] },
  { id: "S15", path: "/my-work", auth: "account_manager", expectedRoute: "/my-work", tags: ["B", "S", "C", "P", "V"] },
  { id: "S16", path: "/poc", auth: "presales_engineer", expectedRoute: "/poc", tags: ["B", "S", "C", "P"] },
  { id: "S17", path: "/proposals", auth: "presales_engineer", expectedRoute: "/proposals", tags: ["B", "S", "C", "P"] },
  { id: "S18", path: "/knowledge", auth: "solution_architect", expectedRoute: "/knowledge", tags: ["B", "S", "C", "P"] },
  { id: "S19", path: "/knowledge-search", auth: "solution_architect", expectedRoute: "/knowledge-search", tags: ["B", "S", "P"] },
  { id: "S20", path: "/agent-console", auth: "system_admin", expectedRoute: "/agent-console", tags: ["B", "S", "P"] },
  { id: "S21", path: "/commands", auth: "system_admin", expectedRoute: "/commands", tags: ["B", "S", "P"] },
  { id: "S22", path: "/ai-team", auth: "solution_architect", expectedRoute: "/ai-team", tags: ["B", "S", "P"] },
  { id: "S23", path: "/agents", auth: "solution_architect", expectedRoute: "/ai-team", tags: ["B", "R", "S"] },
  { id: "S24", path: "/registry/products", auth: "solution_architect", expectedRoute: "/registry/products", tags: ["B", "S", "P"] },
  { id: "S25", path: "/registry/rules", auth: "solution_architect", expectedRoute: "/registry/rules", tags: ["B", "S", "P", "L"] },
  { id: "S26", path: "/delivery", auth: "delivery_engineer", expectedRoute: "/delivery", tags: ["B", "S", "P", "L"] },
  { id: "S27", path: "/delivery/people", auth: "delivery_engineer", expectedRoute: "/delivery/people", tags: ["B", "S", "C", "P"] },
  { id: "S28", path: "/support", auth: "support_engineer", expectedRoute: "/support", tags: ["B", "S", "P", "L"] },
  { id: "S29", path: "/support/policies", auth: "support_engineer", expectedRoute: "/support/policies", tags: ["B", "S", "P"] },
  { id: "S30", path: "/security", auth: "security_officer", expectedRoute: "/security", tags: ["B", "S", "P", "L"] },
  { id: "S31", path: "/settings", auth: "system_admin", expectedRoute: "/settings", tags: ["B", "S", "P"] },
  { id: "S32", path: "/settings/archive", auth: "system_admin", expectedRoute: "/settings/archive", tags: ["B", "S", "C", "A"] },
  { id: "S33", path: "/operator", auth: "system_admin", expectedRoute: "/operator/workflows", tags: ["B", "R", "S", "W"] },
  { id: "S34", path: "/operator/workflows", auth: "system_admin", expectedRoute: "/operator/workflows", tags: ["B", "S", "W", "P", "L"] },
  { id: "S35", path: "/presales", auth: "presales_engineer", expectedRoute: "/deals?view=presales", tags: ["B", "R", "S", "L"] },
  { id: "S36", path: "/development/mail-candidates", auth: "account_manager", expectedRoute: "/inbox?tab=candidates", tags: ["B", "R", "S", "P"] },
  { id: "S37", path: "/cfo/dashboard", auth: "finance_manager", expectedRoute: "/cfo/dashboard", tags: ["B", "S", "Q", "P", "L"] },
  { id: "S38", path: "/cfo/expenses", auth: "finance_manager", expectedRoute: "/cfo/expenses", tags: ["B", "S", "Q", "P"] },
  { id: "S39", path: "/cfo/invoices", auth: "finance_manager", expectedRoute: "/cfo/invoices", tags: ["B", "S", "Q", "P"] },
  { id: "S40", path: "/cfo/tax-invoices", auth: "finance_manager", expectedRoute: "/cfo/tax-invoices", tags: ["B", "S", "Q", "P"] },
  { id: "S41", path: "/cfo/vat", auth: "finance_manager", expectedRoute: "/cfo/vat", tags: ["B", "S", "Q", "P"] },
  { id: "S42", path: "/cfo/settings", auth: "finance_manager", expectedRoute: "/cfo/settings", tags: ["B", "S", "Q", "P"] },
  { id: "D01", path: "/deals/<fixtureId>", auth: "sales_manager", expectedRoute: "/deals/<fixtureId>", fixtureKey: "DEAL_ID", tags: ["B", "S", "P"] },
  { id: "D02", path: "/customers/<fixtureId>", auth: "account_manager", expectedRoute: "/customers/<fixtureId>", fixtureKey: "CUSTOMER_ID", tags: ["B", "S", "P"] },
  { id: "D03", path: "/partners/<fixtureId>", auth: "account_manager", expectedRoute: "/partners/<fixtureId>", fixtureKey: "PARTNER_ID", tags: ["B", "S", "P"] },
  { id: "D04", path: "/tasks/<fixtureId>", auth: "account_manager", expectedRoute: "/tasks/<fixtureId>", fixtureKey: "TASK_ID", tags: ["B", "S", "P"] },
  { id: "D05", path: "/poc/<fixtureId>", auth: "presales_engineer", expectedRoute: "/poc/<fixtureId>", fixtureKey: "POC_ID", tags: ["B", "S", "P"] },
  { id: "D06", path: "/proposals/<fixtureId>", auth: "presales_engineer", expectedRoute: "/proposals/<fixtureId>", fixtureKey: "PROPOSAL_ID", tags: ["B", "S", "P"] },
  { id: "D07", path: "/knowledge/<fixtureId>", auth: "solution_architect", expectedRoute: "/knowledge/<fixtureId>", fixtureKey: "KNOWLEDGE_ID", tags: ["B", "S", "P"] },
  { id: "D08", path: "/approvals/<fixtureId>", auth: "ceo", expectedRoute: "/approvals/<fixtureId>", fixtureKey: "APPROVAL_ID", tags: ["B", "S", "D", "P", "V"] },
  { id: "D09", path: "/projects/<fixtureId>", auth: "delivery_engineer", expectedRoute: "/projects/<fixtureId>", fixtureKey: "PROJECT_ID", tags: ["B", "S", "P"] },
  { id: "D10", path: "/support/<fixtureId>", auth: "support_engineer", expectedRoute: "/support/<fixtureId>", fixtureKey: "SUPPORT_ID", tags: ["B", "S", "P"] },
  { id: "D11", path: "/knowledge/__ux_missing_knowledge__", auth: "solution_architect", expectedRoute: "/knowledge/__ux_missing_knowledge__", tags: ["B", "S", "F"] },
  { id: "D12", path: "/approvals/<fixtureId>", auth: "ceo", expectedRoute: "/approvals/<fixtureId>", fixtureKey: "STALE_APPROVAL_ID", tags: ["B", "S", "D", "F"] },
  { id: "D13", path: "/approvals/<fixtureId>", auth: "ceo", expectedRoute: "/approvals/<fixtureId>", fixtureKey: "CORRUPT_APPROVAL_ID", tags: ["B", "S", "D", "F"] },
  { id: "D14", path: "/__ux-missing-route__", auth: "system_admin", expectedRoute: "/__ux-missing-route__", tags: ["B", "S", "F"] },
];

export type ExpandedRouteCase = Omit<RouteCase, "auth"> & { auth: BusinessRole | "anonymous"; caseId: string };

export const EXPANDED_ROUTE_CASES: readonly ExpandedRouteCase[] = ROUTE_CASES.flatMap((route) =>
  route.auth === "all"
    ? ALL_ROLES.map((role) => ({ ...route, auth: role, caseId: `${route.id}:${role}` }))
    : [{ ...route, auth: route.auth, caseId: route.id }],
);

export function viewportKey(viewport: Viewport): string {
  return `${viewport.width}x${viewport.height}`;
}

export function cellKey(route: ExpandedRouteCase, viewport: Viewport): string {
  return `${route.caseId}@${viewportKey(viewport)}`;
}

export const EXPECTED_CELL_KEYS = EXPANDED_ROUTE_CASES.flatMap((route) =>
  VIEWPORTS.map((viewport) => cellKey(route, viewport)),
);

export function resolveFixturePath(route: ExpandedRouteCase): { path: string; expectedRoute: string } {
  if (!route.fixtureKey) return { path: route.path, expectedRoute: route.expectedRoute };
  const fixtureId = process.env[`UX_FIXTURE_${route.fixtureKey}`]?.trim();
  if (!fixtureId) throw new Error(`UX_FIXTURE_MISSING:${route.fixtureKey}`);
  return {
    path: route.path.replace("<fixtureId>", encodeURIComponent(fixtureId)),
    expectedRoute: route.expectedRoute.replace("<fixtureId>", encodeURIComponent(fixtureId)),
  };
}

export const TOTAL_ROUTE_CASES = ROUTE_CASES.length;
export const TOTAL_EXPANDED_CASES = EXPANDED_ROUTE_CASES.length;
export const TOTAL_VIEWPORTS = VIEWPORTS.length;
export const TOTAL_CELLS = EXPECTED_CELL_KEYS.length;

if (TOTAL_ROUTE_CASES !== 56 || TOTAL_EXPANDED_CASES !== 65 || TOTAL_CELLS !== 195) {
  throw new Error(`UX_ROUTE_INVENTORY_MISMATCH:${TOTAL_ROUTE_CASES}/${TOTAL_EXPANDED_CASES}/${TOTAL_CELLS}`);
}
if (new Set(EXPECTED_CELL_KEYS).size !== 195) throw new Error("UX_CELL_KEY_COLLISION");
