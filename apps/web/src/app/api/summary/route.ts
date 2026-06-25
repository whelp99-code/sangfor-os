import { NextResponse } from "next/server";
import { getExecutiveSummary } from "@ai-portal/automation";

export async function GET() {
  try {
    const summary = await getExecutiveSummary();
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "summary_failed" },
      { status: 400 },
    );
  }
}
