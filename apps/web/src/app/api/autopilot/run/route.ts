import { runAutopilotPass } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runAutopilotPass({ dryRun: body?.dryRun, limit: body?.limit });
    return NextResponse.json(result);
  } catch (error) {
    return apiError("autopilot_run_failed", error, { status: 500 });
  }
}
