import { prisma } from "@sangfor/db";

import { getOpportunityPipelineSummary } from "./opportunity-center";
import { listTodayTasks, listWorkTasks } from "./task-center";

export type ExecutiveSummary = {
  customers: number;
  partners: number;
  openTasks: number;
  todayTasks: number;
  activePocs: number;
  opportunities: { total: number; byStage: Record<string, number> };
  commandRuns: { total: number; running: number };
  approvals: { mailCandidates: number; automation: number };
};

export type DashboardWidgets = {
  todayTasks: Awaited<ReturnType<typeof listTodayTasks>>;
  urgentTasks: Awaited<ReturnType<typeof listWorkTasks>>;
  activePocs: Array<{
    id: string;
    title: string;
    status: string;
    productName: string | null;
    customer: { name: string } | null;
  }>;
  topOpportunities: Array<{
    id: string;
    title: string;
    stage: string;
    probability: number;
    customer: { name: string } | null;
  }>;
  recentProposals: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: Date;
  }>;
  devStatus: {
    latestRuns: Array<{ id: string; status: string; createdAt: Date }>;
    codexTasks: number;
    cursorSessions: number;
    validationFailures: number;
  };
};

function hasAiRevalidation(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const revalidation = (metadata as Record<string, unknown>).aiRevalidation;
  return Boolean(revalidation && typeof revalidation === "object" && !Array.isArray(revalidation));
}

function isProjectMailCandidate(candidateType: string) {
  return candidateType === "task" || candidateType === "opportunity" || candidateType === "poc";
}

export async function getExecutiveSummary(
  projectSlug = "demo-project",
): Promise<ExecutiveSummary> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { slug: projectSlug },
  });

  const [
    customers,
    partners,
    openTasks,
    activePocs,
    commandRunsTotal,
    commandRunsRunning,
    pipeline,
    todayTasks,
    rawMailCandidateApprovals,
    automationApprovals,
  ] = await Promise.all([
    prisma.customer.count({ where: { projectId: project.id } }),
    prisma.partner.count({ where: { projectId: project.id } }),
    prisma.workTask.count({
      where: { projectId: project.id, status: { not: "done" } },
    }),
    prisma.pocProject.count({
      where: { projectId: project.id, status: { notIn: ["completed", "cancelled"] } },
    }),
    prisma.commandRun.count({ where: { projectId: project.id } }),
    prisma.commandRun.count({
      where: { projectId: project.id, status: "running" },
    }),
    getOpportunityPipelineSummary(projectSlug),
    listTodayTasks(projectSlug),
    prisma.mailDerivedCandidate.findMany({
      where: { status: "proposed" },
      select: { candidateType: true, metadata: true },
    }),
    prisma.approvalRequest.count({ where: { status: "pending" } }),
  ]);
  const mailCandidateApprovals = rawMailCandidateApprovals.filter(
    (candidate) =>
      !isProjectMailCandidate(candidate.candidateType) || hasAiRevalidation(candidate.metadata),
  ).length;

  return {
    customers,
    partners,
    openTasks,
    todayTasks: todayTasks.length,
    activePocs,
    opportunities: pipeline,
    commandRuns: { total: commandRunsTotal, running: commandRunsRunning },
    approvals: {
      mailCandidates: mailCandidateApprovals,
      automation: automationApprovals,
    },
  };
}

export async function getDashboardWidgets(
  projectSlug = "demo-project",
): Promise<DashboardWidgets> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { slug: projectSlug },
  });
  const projectId = project.id;

  const [
    todayTasks,
    allTasks,
    activePocs,
    topOpportunities,
    recentProposals,
    latestRuns,
    codexTasks,
    cursorSessions,
    validationFailures,
  ] = await Promise.all([
    listTodayTasks(projectSlug),
    listWorkTasks(projectSlug),
    prisma.pocProject.findMany({
      where: { projectId, status: { notIn: ["completed", "cancelled"] } },
      orderBy: { updatedAt: "desc" },
      take: 8,
      include: { customer: true },
    }),
    prisma.opportunity.findMany({
      where: { projectId, stage: { notIn: ["WON", "LOST"] as const } },
      orderBy: { probability: "desc" },
      take: 8,
      include: { customer: true },
    }),
    prisma.generatedDocument.findMany({
      where: { template: { projectId } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { template: true },
    }),
    prisma.commandRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.codexTask.count(),
    prisma.cursorSession.count(),
    prisma.validationResult.count({ where: { status: "failed" } }),
  ]);

  const urgentTasks = allTasks.filter(
    (t) => t.priority === "high" || t.priority === "urgent",
  );

  return {
    todayTasks,
    urgentTasks: urgentTasks.slice(0, 10),
    activePocs,
    topOpportunities,
    recentProposals,
    devStatus: {
      latestRuns,
      codexTasks,
      cursorSessions,
      validationFailures,
    },
  };
}
