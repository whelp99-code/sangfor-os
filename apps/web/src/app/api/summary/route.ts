import { getExecutiveSummary } from "@sangfor/business";
import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";
import { API_ERRORS } from "../_lib/api-error";

export async function GET() {
  try {
    const summary = await getExecutiveSummary();
    return createApiResponse(summary);
  } catch (error) {
    console.error("[api] summary_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
