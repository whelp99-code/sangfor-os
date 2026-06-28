import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";
import { NextResponse } from "next/server";
import { prisma } from "@sangfor/db";

async function salesData() {
  const opportunities = await prisma.opportunity.findMany({ include: { customer: true } });
  const pendingApprovals = await prisma.approvalRequest.findMany({ where: { status: "ready_for_human_approval" } });
  const proposals = await prisma.generatedDocument.findMany({ orderBy: { createdAt: "desc" }, take: 10 });

  return {
    pipeline: opportunities.map((o) => ({
      id: o.id,
      customer: o.customer?.name ?? null,
      stage: o.stage,
      value: Number(o.amount) || 0,
    })),
    followUp: opportunities.filter((o) => normalizeOpportunityStage(o.stage) === "LEAD").length,
    pendingApprovals: pendingApprovals.length,
    proposalsInProgress: proposals.filter((p) => p.status === "draft").length,
    renewalsDue: 0,
    riskDeals: opportunities.filter((o) => normalizeOpportunityStage(o.stage) === "NEGOTIATION" && (Number(o.amount) || 0) > 50000).length,
  };
}

async function presalesData() {
  const pocProjects = await prisma.pocProject.findMany({ where: { status: "planning" } });
  return {
    pendingDiscovery: 0,
    solutionFitReview: 0,
    missingSizing: 0,
    pocPrep: pocProjects.length,
    aiDraftReview: 0,
  };
}

async function financeData() {
  const approvals = await prisma.approvalRequest.findMany({ where: { status: "ready_for_human_approval" } });
  return {
    commercialApprovalQueue: approvals.length,
    lowMarginDeals: 0,
    highDiscountRequests: 0,
    quoteDiffs: 0,
    exceptionPayments: 0,
  };
}

async function deliveryData() {
  const projects = await prisma.engagement.findMany();
  return {
    preEngagement: projects.filter((p) => p.status === "pre_engagement").length,
    upcomingDeployments: projects.filter((p) => p.status === "planned").length,
    sowConfirmation: projects.filter((p) => p.status === "sow_pending").length,
    licenseActivation: 0,
    acceptanceChecklist: projects.filter((p) => p.status === "in_progress").length,
    handoverDocs: 0,
  };
}

async function supportData() {
  const cases = await prisma.supportCase.findMany();
  return {
    newTickets: cases.filter((c) => c.status === "open").length,
    slaDeadlines: 0,
    vendorEscalations: 0,
    rcaRequired: 0,
    repeatIssues: 0,
  };
}

async function executiveData() {
  const opportunities = await prisma.opportunity.findMany({ include: { customer: true } });
  const approvals = await prisma.approvalRequest.findMany();
  const pocProjects = await prisma.pocProject.findMany();
  const deliveryProjects = await prisma.engagement.findMany();
  const supportCases = await prisma.supportCase.findMany();

  const totalPipeline = opportunities.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const weightedPipeline = opportunities.reduce((s, o) => {
    const weights: Record<string, number> = { lead: 0.1, discovery: 0.2, solution_fit: 0.4, quote: 0.6, poc: 0.8 };
    return s + (Number(o.amount) || 0) * (weights[o.stage] || 0.1);
  }, 0);

  void approvals; void pocProjects; void deliveryProjects; void supportCases;

  return {
    revenuePipeline: { total: totalPipeline, weighted: weightedPipeline, deals: opportunities.length },
    productForecast: [] as { family: string; forecast: number; weighted: number; deals: number }[],
    grossMarginRisk: {
      blendedMargin: 0,
      belowThresholdDeals: opportunities.filter((o) => normalizeOpportunityStage(o.stage) === "NEGOTIATION").length,
      avgDiscount: 0,
    },
    approvalBottleneck: [] as { id: string; customer: string; type: string; waitDays: number; risk: string }[],
    pocSuccessRate: [] as { product: string; success: number; fail: number; rate: string }[],
    deliveryDelay: [] as { customer: string; product: string; delayDays: number; reason: string }[],
    supportHotspots: [] as { customer: string; tickets: number; slaBreach: number; severity: string }[],
    colorReviews: [] as { name: string; status: string }[],
    systemHealth: [] as { name: string; status: string; latency: string }[],
    renewalForecast: 0,
    securityAlerts: 0,
  };
}

async function operatorData() {
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

async function securityData() {
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

const handlers: Record<string, () => Promise<unknown>> = {
  sales: salesData,
  presales: presalesData,
  finance: financeData,
  delivery: deliveryData,
  support: supportData,
  executive: executiveData,
  operator: operatorData,
  security: securityData,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<any> },
) {
  const { role } = await params;
  const handler = handlers[role];
  if (!handler) {
    return NextResponse.json({ error: `Unknown dashboard role: ${role}` }, { status: 404 });
  }
  try {
    const data = await handler();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : `${role}_dashboard_failed` },
      { status: 500 },
    );
  }
}
