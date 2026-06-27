export const ROLE_MODES = [
  "sales",
  "presales",
  "delivery",
  "support",
  "cfo",
  "operator",
  "security",
] as const;

export type RoleMode = (typeof ROLE_MODES)[number];

export const AI_EXECUTION_MODES = [
  "draft",
  "review",
  "approve",
  "smoke",
  "full",
  "manual",
  "assisted",
  "autonomous",
  "color-agent-review",
] as const;

export type AiExecutionMode = (typeof AI_EXECUTION_MODES)[number];

export const OPERATING_MODES = [
  "dev",
  "demo",
  "staging",
  "production",
  "mock-upstream",
  "real-upstream",
  "read-only",
  "write-enabled",
] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

export const UNSAFE_ACTIONS = [
  "send",
  "export",
  "share",
  "delete",
  "deploy",
  "real-upstream-write",
  "production-db-mutation",
  "release-tag",
] as const;

export type UnsafeAction = (typeof UNSAFE_ACTIONS)[number];

export type ModeMatrixEntry = {
  role: RoleMode;
  dashboardPath: string;
  allowedActions: string[];
  blockedActions: UnsafeAction[];
  approvalResponsibilities: string[];
  evidenceVisible: boolean;
  successScenario: string;
};

const ALL_UNSAFE = [...UNSAFE_ACTIONS];

export const MODE_MATRIX: readonly ModeMatrixEntry[] = [
  {
    role: "sales",
    dashboardPath: "/sales",
    allowedActions: ["view-dashboard", "create-customer", "create-opportunity", "request-approval"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["prepare evidence before requesting quote/proposal approval"],
    evidenceVisible: true,
    successScenario: "Create or approve a qualified opportunity with evidence-backed proposal draft.",
  },
  {
    role: "presales",
    dashboardPath: "/presales",
    allowedActions: ["view-dashboard", "create-poc", "draft-technical-proposal", "request-review"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["review technical fit and attach implementation evidence"],
    evidenceVisible: true,
    successScenario: "Review PoC or proposal evidence and prepare technical approval input.",
  },
  {
    role: "delivery",
    dashboardPath: "/delivery",
    allowedActions: ["view-dashboard", "update-delivery-checklist", "record-asset"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["confirm delivery acceptance before asset/license activation"],
    evidenceVisible: true,
    successScenario: "Complete delivery checklist and produce auditable asset handoff evidence.",
  },
  {
    role: "support",
    dashboardPath: "/support",
    allowedActions: ["view-dashboard", "create-support-case", "draft-rca"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["review RCA draft before external customer sharing"],
    evidenceVisible: true,
    successScenario: "Create support case linked to customer asset and RCA draft evidence.",
  },
  {
    role: "cfo",
    dashboardPath: "/cfo/dashboard",
    allowedActions: ["view-dashboard", "review-margin", "review-cashflow", "approve-commercial"],
    blockedActions: ["send", "share", "delete", "deploy", "real-upstream-write", "production-db-mutation", "release-tag"],
    approvalResponsibilities: ["approve low-margin or high-discount commercial actions"],
    evidenceVisible: true,
    successScenario: "Review quote margin and commercial approval evidence before finance handoff.",
  },
  {
    role: "operator",
    dashboardPath: "/operator",
    allowedActions: ["view-dashboard", "run-smoke-check", "inspect-health", "inspect-runbook"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["verify health, smoke, and rollback readiness before release"],
    evidenceVisible: true,
    successScenario: "Inspect system health and W1-W2 verification status from one workspace.",
  },
  {
    role: "security",
    dashboardPath: "/security",
    allowedActions: ["view-dashboard", "inspect-audit", "inspect-policy", "review-gated-action"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["verify unsafe actions remain gated and audited"],
    evidenceVisible: true,
    successScenario: "Inspect unsafe action policy, audit coverage, and approval gate evidence.",
  },
] as const;

export function isUnsafeAction(action: string): action is UnsafeAction {
  return (UNSAFE_ACTIONS as readonly string[]).includes(action);
}

export function requiresApprovalForAction(action: string): boolean {
  return isUnsafeAction(action);
}

export function getRoleModeEntry(role: RoleMode): ModeMatrixEntry {
  const entry = MODE_MATRIX.find((item) => item.role === role);
  if (!entry) throw new Error(`unknown_role_mode:${role}`);
  return entry;
}
