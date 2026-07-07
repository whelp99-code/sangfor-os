import { extractDomainPipeline, resolveDefaultProjectSlug } from "@sangfor/business";
import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";
import { API_ERRORS } from "../_lib/api-error";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const slug = await resolveDefaultProjectSlug();
    const snapshot = await extractDomainPipeline(slug);
    return createApiResponse(snapshot);
  } catch (error) {
    console.error("[api] domain_pipeline_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
