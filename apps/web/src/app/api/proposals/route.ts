import { generateProposal, listGeneratedDocuments } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";
import { API_ERRORS } from "../_lib/api-error";

export async function GET() {
  try {
    const documents = await listGeneratedDocuments();
    return createApiResponse({ documents });
  } catch (error) {
    console.error("[api] list_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const document = await generateProposal(body);
    return createApiResponse({ document }, 201);
  } catch (error) {
    console.error("[api] generate_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
