import { runWorkflowMock } from "@ai-portal/automation";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ commandRunId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { commandRunId } = await context.params;
  try {
    const summary = await runWorkflowMock(commandRunId);
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "workflow_failed" },
      { status: 500 },
    );
  }
}
