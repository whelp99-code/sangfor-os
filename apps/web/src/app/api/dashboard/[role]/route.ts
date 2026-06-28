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

  return {
    revenuePipeline: { total: totalPipeline, weighted: weightedPipeline, deals: opportunities.length },
    productForecast: [
      { family: "Sangfor NGAF", forecast: Math.round(totalPipeline * 0.35), weighted: Math.round(weightedPipeline * 0.35), deals: 4 },
      { family: "Sangfor aDesk", forecast: Math.round(totalPipeline * 0.22), weighted: Math.round(weightedPipeline * 0.22), deals: 3 },
      { family: "Sangfor HCI", forecast: Math.round(totalPipeline * 0.18), weighted: Math.round(weightedPipeline * 0.18), deals: 2 },
      { family: "Sangfor IAM", forecast: Math.round(totalPipeline * 0.15), weighted: Math.round(weightedPipeline * 0.15), deals: 2 },
      { family: "Sangfor SD-WAN", forecast: Math.round(totalPipeline * 0.10), weighted: Math.round(weightedPipeline * 0.10), deals: 1 },
    ],
    grossMarginRisk: {
      blendedMargin: 34.2,
      belowThresholdDeals: opportunities.filter((o) => normalizeOpportunityStage(o.stage) === "NEGOTIATION").length,
      avgDiscount: 28.5,
    },
    approvalBottleneck: [
      { id: "OPP-2024-0842", customer: "신한은행", type: "Special Discount", waitDays: 4, risk: "high" },
      { id: "OPP-2024-0791", customer: "현대모비스", type: "Payment Terms", waitDays: 7, risk: "medium" },
      { id: "OPP-2024-0765", customer: "LG CNS", type: "Margin Override", waitDays: 2, risk: "low" },
      { id: "OPP-2024-0723", customer: "SK Telecom", type: "Contract Value", waitDays: 11, risk: "high" },
    ],
    pocSuccessRate: [
      { product: "NGAF", success: 8, fail: 1, rate: "89%" },
      { product: "aDesk", success: 6, fail: 2, rate: "75%" },
      { product: "HCI", success: 4, fail: 0, rate: "100%" },
      { product: "IAM", success: 3, fail: 1, rate: "75%" },
      { product: "SD-WAN", success: 2, fail: 0, rate: "100%" },
    ],
    deliveryDelay: [
      { customer: "기아자동차", product: "NGAF-4000", delayDays: 14, reason: "License import delay" },
      { customer: "KB국민은행", product: "aDesk-V", delayDays: 7, reason: "Site prep incomplete" },
      { customer: "삼성전자", product: "HCI-2000", delayDays: 3, reason: "SOW not signed" },
    ],
    supportHotspots: [
      { customer: "롯데정보통신", tickets: 12, slaBreach: 3, severity: "critical" },
      { customer: "KT Cloud", tickets: 8, slaBreach: 1, severity: "warning" },
      { customer: "네이버클라우드", tickets: 5, slaBreach: 0, severity: "ok" },
    ],
    colorReviews: [
      { name: "Blue", status: "passed" },
      { name: "Red", status: "pending" },
      { name: "Orange", status: "failed" },
      { name: "Gray", status: "passed" },
      { name: "Teal", status: "not_required" },
    ],
    systemHealth: [
      { name: "AI Orchestrator", status: "ok", latency: "12ms" },
      { name: "Mail Intelligence", status: "ok", latency: "45ms" },
      { name: "Knowledge Base", status: "ok", latency: "23ms" },
      { name: "Tool Gateway", status: "degraded", latency: "890ms" },
      { name: "Approval Engine", status: "ok", latency: "8ms" },
      { name: "Agent Runtime", status: "ok", latency: "34ms" },
      { name: "Document API", status: "error", latency: "—" },
      { name: "Audit Chain", status: "ok", latency: "56ms" },
    ],
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
