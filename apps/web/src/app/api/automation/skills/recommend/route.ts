import { recommendSkillsForInput } from "@sangfor/business/skills";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/automation/skills/recommend/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const body = await request.json();
    const result = await recommendSkillsForInput(body);
    return NextResponse.json(result);
  } catch (error) {
    return apiError("recommend_failed", error, { status: 400 });
  }
}
