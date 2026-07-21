import { updatePolicyMemory } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { createApiResponse, createApiErrorResponse } from "../../_lib/api-response";
import { API_ERRORS } from "../../_lib/api-error";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/policy-memories/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const { id } = await params;
  try {
    const body = await request.json();
    const updated = await updatePolicyMemory(id, body);
    return createApiResponse({ policyMemory: updated });
  } catch (error) {
    console.error("[api] patch_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
