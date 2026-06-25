import { assessRisk } from "@ai-portal/automation/automation-preview";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ risk: assessRisk(body), previewOnly: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "automation_risk_failed" },
      { status: 400 },
    );
  }
}
