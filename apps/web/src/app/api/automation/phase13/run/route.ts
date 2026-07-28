import { runPhase13Orchestrator } from "@sangfor/business/skills";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/automation/phase13/run/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const body = await request.json();
    const result = await runPhase13Orchestrator(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError("phase13_run_failed", error, { status: 400 });
  }
}
