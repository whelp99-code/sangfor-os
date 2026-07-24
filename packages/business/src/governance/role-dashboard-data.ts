import { prisma } from "@sangfor/db";
import type { AuthContext } from "@sangfor/auth";
import {
  calculateSalesDashboard,
  calculatePresalesDashboard,
  calculateFinanceDashboard,
  calculateSupportDashboard,
  calculateOperatorDashboard,
  calculateSecurityDashboard,
} from "./role-dashboard";
import { isActiveOpportunity, normalizeOpportunityStage } from "../crm/opportunity-stage";
import { listOpportunities } from "../crm/opportunity-center";
import { listEngagements } from "../crm/engagement-center";

async function salesData(ctx: AuthContext | null) {
  if (!ctx) return calculateSalesDashboard({ opportunities: [], pendingApprovals: [], proposals: [] });
  const [opportunities, pendingApprovals, proposals] = await Promise.all([
    listOpportunities(ctx, { first: 100 }).then((page) => page.items),
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

async function deliveryData(ctx: AuthContext | null) {
  const projects = ctx ? await listEngagements(ctx) : [];
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

async function executiveData(ctx: AuthContext | null) {
  const projectId = ctx?.projectId ?? "";
  const opportunities = ctx ? (await listOpportunities(ctx, { first: 100 })).items : [];
  const approvals = await prisma.approvalRequest.findMany();
  const pocProjects = await prisma.pocProject.findMany({ where: { projectId } });
  const deliveryProjects = ctx ? await listEngagements(ctx) : [];
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

export async function getRoleDashboardData(
  role: string,
  scope: AuthContext | string,
): Promise<unknown | null> {
  const ctx = typeof scope === "object" ? scope : null;
  const projectId = ctx?.projectId ?? "";
  const handlers: Record<string, () => Promise<unknown>> = {
    sales: () => salesData(ctx),
    presales: () => presalesData(projectId),
    finance: () => financeData(projectId),
    delivery: () => deliveryData(ctx),
    support: () => supportData(projectId),
    executive: () => executiveData(ctx),
    operator: () => operatorData(projectId),
    security: () => securityData(projectId),
  };

  const handler = handlers[role];
  if (!handler) return null;
  return handler();
}
