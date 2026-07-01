import { prisma } from "@sangfor/db";
import {
  buildDomainDashboardSnapshot,
  createPrismaDomainStatsLoader,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const loader = createPrismaDomainStatsLoader(prisma as never, "demo-project");
    const snapshot = await buildDomainDashboardSnapshot(loader);
    return NextResponse.json(snapshot);
  } catch (error) {
    return apiError("domain_pipeline_failed", error, { status: 400 });
  }
}
