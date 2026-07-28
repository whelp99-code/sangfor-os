import { createExecutionPlan } from "@sangfor/business/automation-preview";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { createApiResponse, createApiErrorResponse } from "../../_lib/api-response";
import { API_ERRORS } from "../../_lib/api-error";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/automation/plan/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const body = await request.json();
    return createApiResponse(createExecutionPlan(body));
  } catch (error) {
    console.error("[api] automation_plan_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
