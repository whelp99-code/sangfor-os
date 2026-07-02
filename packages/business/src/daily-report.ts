import { prisma } from "@sangfor/db";

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
 */
export async function generateDailyReport(): Promise<DailyReportData> {
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

  const customers = await prisma.customer.count();
  const partners = await prisma.partner.count();
  const tasks = await prisma.workTask.count();
  const opportunities = await prisma.opportunity.count();

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
