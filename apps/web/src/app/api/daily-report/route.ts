import { prisma } from "@sangfor/db";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

export async function GET() {
  try {
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

    return NextResponse.json({
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
    });
  } catch (error) {
    return apiError("report_failed", error, { status: 400 });
  }
}
