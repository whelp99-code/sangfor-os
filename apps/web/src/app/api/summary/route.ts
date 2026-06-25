import { NextResponse } from "next/server";
import { getExecutiveSummary } from "@sangfor/business";

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
