import { resolveDefaultProjectId } from "@sangfor/business";
import { isActiveOpportunity, normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";
import {
  calculateSalesDashboard,
  calculatePresalesDashboard,
  calculateFinanceDashboard,
  calculateSupportDashboard,
  calculateOperatorDashboard,
  calculateSecurityDashboard,
} from "@sangfor/business/role-dashboard";
import { NextResponse } from "next/server";
import { prisma } from "@sangfor/db";
import { apiError } from "@/lib/api-auth";

async function salesData(projectId: string) {
  const [opportunities, pendingApprovals, proposals] = await Promise.all([
    prisma.opportunity.findMany({ where: { projectId }, include: { customer: true } }),
    prisma.approvalRequest.findMany({ where: { status: "ready_for_human_approval" } }),
    prisma.generatedDocument.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return calculateSalesDashboard({ opportunities, pendingApprovals, proposals });
}

async function presalesData(projectId: string) {
  const pocProjects = await prisma.pocProject.findMany({ where: { status: "planning", projectId } });
  return calculatePresalesDashboard({ pocProjects });
}

async function financeData(_projectId: string) {
  const approvals = await prisma.approvalRequest.findMany({ where: { status: "ready_for_human_approval" } });
  return calculateFinanceDashboard({ approvals });
}

async function deliveryData(projectId: string) {
  const projects = await prisma.engagement.findMany({ where: { projectId } });
  return {
    preEngagement: projects.filter((p) => p.status === "pre_engagement").length,
    upcomingDeployments: projects.filter((p) => p.status === "planned").length,
    sowConfirmation: projects.filter((p) => p.status === "sow_pending").length,
    licenseActivation: 0,
    acceptanceChecklist: projects.filter((p) => p.status === "in_progress").length,
    handoverDocs: 0,
  };
}

async function supportData(_projectId: string) {
  const cases = await prisma.supportCase.findMany();
  return calculateSupportDashboard({ cases });
}

async function executiveData(projectId: string) {
  const opportunities = await prisma.opportunity.findMany({ where: { projectId }, include: { customer: true } });
  const approvals = await prisma.approvalRequest.findMany();
  const pocProjects = await prisma.pocProject.findMany({ where: { projectId } });
  const deliveryProjects = await prisma.engagement.findMany({ where: { projectId } });
  const supportCases = await prisma.supportCase.findMany();

  const activeOpportunities = opportunities.filter((o) => isActiveOpportunity(o.stage));

  const totalPipeline = activeOpportunities.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const weightedPipeline = activeOpportunities.reduce((s, o) => {
    // Canonical stage weights — normalize before lookup to fix the lowercase-key bug.
    const weights: Record<string, number> = {
      LEAD: 0.1, QUALIFIED: 0.2, PROPOSAL: 0.4, POC: 0.6, NEGOTIATION: 0.8,
    };
    return s + (Number(o.amount) || 0) * (weights[normalizeOpportunityStage(o.stage)] ?? 0.1);
  }, 0);

  void approvals; void pocProjects; void deliveryProjects; void supportCases;

  return {
    revenuePipeline: { total: totalPipeline, weighted: weightedPipeline, deals: activeOpportunities.length },
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

async function operatorData(_projectId: string) {
  return calculateOperatorDashboard();
}

async function securityData(_projectId: string) {
  return calculateSecurityDashboard();
}

const handlers: Record<string, (projectId: string) => Promise<unknown>> = {
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
  request: Request,
  { params }: { params: Promise<any> },
) {
  const { role } = await params;
  const handler = handlers[role];
  if (!handler) {
    return NextResponse.json({ error: `Unknown dashboard role: ${role}` }, { status: 404 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") ?? (await resolveDefaultProjectId());
    const data = await handler(projectId);
    return NextResponse.json(data);
  } catch (error) {
    return apiError(`${role}_dashboard_failed`, error, { status: 500 });
  }
}
