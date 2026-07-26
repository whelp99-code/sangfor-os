import { getLlmSettingsStatus, saveLlmSettings } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { createApiResponse, createApiErrorResponse } from "../../_lib/api-response";
import { API_ERRORS } from "../../_lib/api-error";

// Web-managed OpenAI-compatible LLM credentials (no OAuth for OpenAI APIs).
// GET returns a masked status; the full key is never returned.
export async function GET() {
  try {
    return createApiResponse(await getLlmSettingsStatus());
  } catch (error) {
    console.warn("[api] llm_status_unavailable:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiResponse({ configured: false, source: "none", availability: "unavailable" });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/settings/llm/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const body = await request.json().catch(() => ({}));
    await saveLlmSettings({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
    });
    return createApiResponse(await getLlmSettingsStatus());
  } catch (error) {
    console.error("[api] save_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
