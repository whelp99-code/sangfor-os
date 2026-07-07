import { prisma } from "@sangfor/db";
import type { OpportunityStage } from "@prisma/client";
import { ACTIVE_OPPORTUNITY_STAGES } from "./crm/opportunity-stage";
import { resolveDefaultProjectId } from "./default-project";

export interface DailyReportData {
  date: string;
  mail: {
    todayCandidates: number;
    pendingApproval: number;
    todayApproved: number;
    todayConverted: number;
  };
  entities: {
    customers: number;
    partners: number;
    tasks: number;
    opportunities: number;
  };
  candidatesByType: unknown;
}

/**
 * Assemble the daily operations report (mail-intelligence throughput + entity counts).
 * Extracted from apps/web route to decouple presentation from persistence.
 *
 * When a projectId is provided (or inferred via the default-project resolver),
 * entity counts are scoped to that project.  Mail-derived-candidate queries
 * are left unscoped (the model does not carry a projectId FK).
 */
export async function generateDailyReport(projectId?: string): Promise<DailyReportData> {
  const resolvedId = projectId ?? (await resolveDefaultProjectId());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const candidates = await prisma.mailDerivedCandidate.groupBy({
    by: ["candidateType", "status"],
    _count: true,
  });

  const todayCandidates = await prisma.mailDerivedCandidate.count({
    where: { createdAt: { gte: today } },
  });

  const pendingApproval = await prisma.mailDerivedCandidate.count({
    where: { status: "proposed" },
  });

  const todayApproved = await prisma.mailDerivedCandidate.count({
    where: {
      status: "approved",
      updatedAt: { gte: today },
    },
  });

  const todayConverted = await prisma.mailDerivedCandidate.count({
    where: {
      status: "converted",
      updatedAt: { gte: today },
    },
  });

  const [customers, partners, tasks, opportunities] = await Promise.all([
    prisma.customer.count({ where: { projectId: resolvedId } }),
    prisma.partner.count({ where: { projectId: resolvedId } }),
    prisma.workTask.count({ where: { projectId: resolvedId } }),
    prisma.opportunity.count({
      where: {
        projectId: resolvedId,
        stage: { in: [...ACTIVE_OPPORTUNITY_STAGES] as OpportunityStage[] },
      },
    }),
  ]);

  return {
    date: today.toISOString().split("T")[0],
    mail: {
      todayCandidates,
      pendingApproval,
      todayApproved,
      todayConverted,
    },
    entities: {
      customers,
      partners,
      tasks,
      opportunities,
    },
    candidatesByType: candidates,
  };
}
