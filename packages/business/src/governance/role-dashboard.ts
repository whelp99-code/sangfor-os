import { isActiveOpportunity, normalizeOpportunityStage } from "../crm/opportunity-stage";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Opportunities in NEGOTIATION stage with an amount above this threshold are
 * flagged as risk deals in the sales dashboard.
 */
export const LARGE_DEAL_RISK_THRESHOLD = 50000;

// ---------------------------------------------------------------------------
// Return-type interfaces
// ---------------------------------------------------------------------------

export interface SalesDashboard {
  pipeline: Array<{ id: string; customer: string | null; stage: string; value: number }>;
  followUp: number;
  pendingApprovals: number;
  proposalsInProgress: number;
  renewalsDue: number;
  riskDeals: number;
}

export interface PresalesDashboard {
  pendingDiscovery: number;
  solutionFitReview: number;
  missingSizing: number;
  pocPrep: number;
  aiDraftReview: number;
}

export interface FinanceDashboard {
  commercialApprovalQueue: number;
  lowMarginDeals: number;
  highDiscountRequests: number;
  quoteDiffs: number;
  exceptionPayments: number;
}

export interface SupportDashboard {
  newTickets: number;
  slaDeadlines: number;
  vendorEscalations: number;
  rcaRequired: number;
  repeatIssues: number;
}

export interface OperatorDashboard {
  systemHealth: { api: string; web: string; finance: string; postgres: string; redis: string };
  workflowQueue: number;
  aiUsage: { todayTokens: number; todayCost: number; providerCalls: number };
  toolLogs: never[];
  failedJobs: number;
  rlsPolicyCheck: string;
  auditIntegrity: string;
  backupStatus: string;
  tenantHealth: { total: number; healthy: number };
}

export interface SecurityDashboard {
  restrictedDataAccess: never[];
  roleChanges: number;
  privilegedAccess: number;
  auditMismatch: boolean;
  aiPolicyViolations: number;
  exportEvents: never[];
  workflowChanges: number;
}

// ---------------------------------------------------------------------------
// Params interfaces
// ---------------------------------------------------------------------------

export interface SalesDashboardParams {
  opportunities: Array<{
    id: string;
    stage: string;
    amount: unknown;
    customer?: { name: string | null } | null;
  }>;
  pendingApprovals: unknown[];
  proposals: Array<{ status: string }>;
}

export interface PresalesDashboardParams {
  pocProjects: unknown[];
}

export interface FinanceDashboardParams {
  approvals: unknown[];
}

export interface SupportDashboardParams {
  cases: Array<{ status: string }>;
}

// ---------------------------------------------------------------------------
// Dashboard calculators (pure functions, no Prisma calls)
// ---------------------------------------------------------------------------

export function calculateSalesDashboard(params: SalesDashboardParams): SalesDashboard {
  const { opportunities, pendingApprovals, proposals } = params;

  return {
    pipeline: opportunities
      .filter((o) => isActiveOpportunity(o.stage))
      .map((o) => ({
        id: o.id,
        customer: o.customer?.name ?? null,
        stage: o.stage,
        value: Number(o.amount) || 0,
      })),
    followUp: opportunities.filter((o) => normalizeOpportunityStage(o.stage) === "LEAD").length,
    pendingApprovals: pendingApprovals.length,
    proposalsInProgress: proposals.filter((p) => p.status === "draft").length,
    renewalsDue: 0,
    riskDeals: opportunities.filter(
      (o) =>
        normalizeOpportunityStage(o.stage) === "NEGOTIATION" &&
        (Number(o.amount) || 0) > LARGE_DEAL_RISK_THRESHOLD,
    ).length,
  };
}

export function calculatePresalesDashboard(params: PresalesDashboardParams): PresalesDashboard {
  return {
    pendingDiscovery: 0,
    solutionFitReview: 0,
    missingSizing: 0,
    pocPrep: params.pocProjects.length,
    aiDraftReview: 0,
  };
}

export function calculateFinanceDashboard(params: FinanceDashboardParams): FinanceDashboard {
  return {
    commercialApprovalQueue: params.approvals.length,
    lowMarginDeals: 0,
    highDiscountRequests: 0,
    quoteDiffs: 0,
    exceptionPayments: 0,
  };
}

export function calculateSupportDashboard(params: SupportDashboardParams): SupportDashboard {
  return {
    newTickets: params.cases.filter((c) => c.status === "open").length,
    slaDeadlines: 0,
    vendorEscalations: 0,
    rcaRequired: 0,
    repeatIssues: 0,
  };
}

export function calculateOperatorDashboard(): OperatorDashboard {
  return {
    systemHealth: { api: "ok", web: "ok", finance: "unreachable", postgres: "ok", redis: "ok" },
    workflowQueue: 0,
    aiUsage: { todayTokens: 0, todayCost: 0, providerCalls: 0 },
    toolLogs: [],
    failedJobs: 0,
    rlsPolicyCheck: "active",
    auditIntegrity: "verified",
    backupStatus: "ok",
    tenantHealth: { total: 1, healthy: 1 },
  };
}

export function calculateSecurityDashboard(): SecurityDashboard {
  return {
    restrictedDataAccess: [],
    roleChanges: 0,
    privilegedAccess: 0,
    auditMismatch: false,
    aiPolicyViolations: 0,
    exportEvents: [],
    workflowChanges: 0,
  };
}
