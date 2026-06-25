import { createExecutionPlan } from "@sangfor/business/automation-preview";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(createExecutionPlan(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "automation_plan_failed" },
      { status: 400 },
    );
  }
}
