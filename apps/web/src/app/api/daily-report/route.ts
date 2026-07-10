import { buildDailyBrief, generateDailyReport, resolveDefaultProjectId } from "@sangfor/business";
import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";
import { API_ERRORS } from "../_lib/api-error";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") ?? undefined;
    const resolvedId = projectId ?? (await resolveDefaultProjectId());

    if (searchParams.get("brief") === "1") {
      const brief = await buildDailyBrief(resolvedId);
      return createApiResponse(brief);
    }

    const report = await generateDailyReport(resolvedId);
    return createApiResponse(report);
  } catch (error) {
    console.error("[api] report_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
