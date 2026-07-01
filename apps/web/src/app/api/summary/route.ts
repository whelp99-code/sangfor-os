import { getExecutiveSummary } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

export async function GET() {
  try {
    const summary = await getExecutiveSummary();
    return NextResponse.json(summary);
  } catch (error) {
    return apiError("summary_failed", error, { status: 400 });
  }
}
