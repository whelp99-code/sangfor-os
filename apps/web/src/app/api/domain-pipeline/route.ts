import { extractDomainPipeline } from "@sangfor/business";
import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";
import { API_ERRORS } from "../_lib/api-error";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await extractDomainPipeline("demo-project");
    return createApiResponse(snapshot);
  } catch (error) {
    console.error("[api] domain_pipeline_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
