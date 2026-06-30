import { runWorkflowMock } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ commandRunId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const { commandRunId } = await context.params;
  try {
    const summary = await runWorkflowMock(commandRunId);
    return NextResponse.json({ summary });
  } catch (error) {
    return apiError("workflow_failed", error, { status: 500 });
  }
}
