import { runPhase13Orchestrator } from "@ai-portal/automation/skills";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runPhase13Orchestrator(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "phase13_run_failed" },
      { status: 400 },
    );
  }
}
