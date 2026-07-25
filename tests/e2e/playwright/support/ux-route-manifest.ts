/**
 * U066 — Authoritative UX Route/Viewport/Role Manifest
 *
 * 37 route cases × 3 viewports × 10 BusinessRoles = 195 cells (denominator).
 * This manifest is the sole source of truth for the UX checkpoint matrix.
 */

export type Viewport = { label: string; width: number; height: number };

export const VIEWPORTS: Viewport[] = [
  { label: "mobile", width: 375, height: 812 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1280, height: 900 },
];

export type BusinessRole =
  | "ceo"
  | "sales_manager"
  | "account_manager"
  | "presales_engineer"
  | "solution_architect"
  | "finance_manager"
  | "delivery_engineer"
  | "support_engineer"
  | "security_officer"
  | "system_admin";

export const ALL_ROLES: BusinessRole[] = [
  "ceo", "sales_manager", "account_manager", "presales_engineer",
  "solution_architect", "finance_manager", "delivery_engineer",
  "support_engineer", "security_officer", "system_admin",
];

export type TestTag = "B" | "L" | "S" | "C" | "P" | "A" | "D" | "R" | "F" | "V" | "W" | "Q";

export type RouteCase = {
  id: string;
  path: string;
  auth: BusinessRole | "anonymous" | "all";
  expectedRoute: string;
  tags: TestTag[];
};

export const ROUTE_CASES: RouteCase[] = [
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
  { id: "S36", path: "/development/mail-candidates", auth: "account_manager", expectedRoute: "/development/mail-candidates", tags: ["B", "S", "P"] },
  { id: "S37", path: "/cfo/dashboard", auth: "finance_manager", expectedRoute: "/cfo/dashboard", tags: ["B", "S", "Q", "P", "L"] },
];

export const TOTAL_ROUTE_CASES = ROUTE_CASES.length;
export const TOTAL_VIEWPORTS = VIEWPORTS.length;
export const TOTAL_CELLS = 65 * TOTAL_VIEWPORTS;

export const ROLE_LANDING_MAP: Record<BusinessRole, string> = {
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
