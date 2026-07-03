import { analyzeIntent } from "@sangfor/business/automation-preview";
import { assertApiAccess } from "@/lib/api-auth";
import { createApiResponse, createApiErrorResponse } from "../../_lib/api-response";
import { API_ERRORS } from "../../_lib/api-error";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    return createApiResponse({ analysis: analyzeIntent(body), previewOnly: true });
  } catch (error) {
    console.error("[api] automation_analyze_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
