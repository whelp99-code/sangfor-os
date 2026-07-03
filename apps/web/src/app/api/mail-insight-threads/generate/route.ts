import { generateMailInsightThreads } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { createApiResponse, createApiErrorResponse } from "../../_lib/api-response";
import { API_ERRORS } from "../../_lib/api-error";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 100), 2000);

    const result = await generateMailInsightThreads(limit);

    return createApiResponse(result, 201);
  } catch (error) {
    console.error("[api] generate_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
