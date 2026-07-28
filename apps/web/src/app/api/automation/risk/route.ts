import { assessRisk } from "@sangfor/business/automation-preview";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/automation/risk/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const body = await request.json();
    return NextResponse.json({ risk: assessRisk(body), previewOnly: true });
  } catch (error) {
    return apiError("automation_risk_failed", error, { status: 400 });
  }
}
