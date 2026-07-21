import { runAutopilotPass } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/autopilot/run/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runAutopilotPass({ dryRun: body?.dryRun, limit: body?.limit });
    return NextResponse.json(result);
  } catch (error) {
    return apiError("autopilot_run_failed", error, { status: 500 });
  }
}
