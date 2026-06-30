import { getObservabilitySummary, runValidationPlan } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET() {
  try {
    const summary = await getObservabilitySummary();
    return NextResponse.json(summary);
  } catch (error) {
    return apiError("summary_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
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
    return apiError("validation_failed", error, { status: 400 });
  }
}
