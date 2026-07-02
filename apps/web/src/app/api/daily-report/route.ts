import { generateDailyReport } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

export async function GET() {
  try {
    const report = await generateDailyReport();
    return NextResponse.json(report);
  } catch (error) {
    return apiError("report_failed", error, { status: 400 });
  }
}
