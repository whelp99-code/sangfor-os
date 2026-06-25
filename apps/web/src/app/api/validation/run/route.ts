import { getObservabilitySummary, runValidationPlan } from "@ai-portal/automation";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const summary = await getObservabilitySummary();
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "summary_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { commandRunId, checks } = body as {
      commandRunId: string;
      checks: { key: string; passed: boolean }[];
    };
    const plan = await runValidationPlan(commandRunId, checks ?? [
      { key: "lint", passed: true },
      { key: "test", passed: true },
      { key: "build", passed: true },
    ]);
    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "validation_failed" },
      { status: 400 },
    );
  }
}
