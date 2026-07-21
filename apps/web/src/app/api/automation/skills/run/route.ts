import { runSingleSkill } from "@sangfor/business/skills";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/automation/skills/run/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const body = await request.json();
    const result = await runSingleSkill(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError("run_failed", error, { status: 400 });
  }
}
