export const ROLE_MODES = [
  "marketing",
  "sales",
  "presales",
  "engineer",
  "delivery",
  "support",
  "cfo",
  "operator",
  "security",
] as const;

export type RoleMode = (typeof ROLE_MODES)[number];

/**
 * 종축(업무 도메인) 파이프라인 순서 — 마케팅 → 영업 → 프리세일즈 → 엔지니어 → CFO.
 * 컬러 렌즈(횡축)와 직교한다. 도메인 AI가 추가되는 축.
 * operator/security 는 GTM 파이프라인 밖의 내부 거버넌스 모드라 제외.
 */
export const GTM_PIPELINE = [
  "marketing",
  "sales",
  "presales",
  "engineer",
  "cfo",
] as const;

export type GtmDomain = (typeof GTM_PIPELINE)[number];

export function isGtmDomain(role: string): role is GtmDomain {
  return (GTM_PIPELINE as readonly string[]).includes(role);
}

/** 파이프라인에서 다음 도메인 (마지막이면 null). */
export function nextGtmDomain(domain: GtmDomain): GtmDomain | null {
  const idx = GTM_PIPELINE.indexOf(domain);
  if (idx < 0 || idx === GTM_PIPELINE.length - 1) return null;
  return GTM_PIPELINE[idx + 1];
}

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
    role: "marketing",
    dashboardPath: "/marketing",
    allowedActions: ["view-dashboard", "classify-lead", "attribute-campaign", "draft-content"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["qualify lead with evidence before sales handoff"],
    evidenceVisible: true,
    successScenario: "Classify inbound lead, attribute to campaign, and hand a qualified lead to sales.",
  },
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
    role: "engineer",
    dashboardPath: "/engineer",
    allowedActions: ["view-dashboard", "record-field-engagement", "update-delivery-checklist", "draft-rca"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["confirm field deployment and asset handoff before finance review"],
    evidenceVisible: true,
    successScenario: "Complete on-site engineering (SE) deployment and produce auditable asset handoff for CFO.",
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
