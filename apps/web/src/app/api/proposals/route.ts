import { generateProposal, listGeneratedDocuments } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import {
  enforceRequestedProject,
  relatedResourcesBelongToProject,
  resolveProjectScope,
} from "@/lib/project-scope";
import { createApiResponse, createApiErrorResponse } from "../_lib/api-response";
import { API_ERRORS } from "../_lib/api-error";

export async function GET(request: Request) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  try {
    const documents = await listGeneratedDocuments(project.scope.projectSlug);
    return createApiResponse({ documents });
  } catch (error) {
    console.error("[api] list_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/proposals/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  try {
    const body = await request.json();
    const forbidden = enforceRequestedProject(project.scope, body.projectSlug);
    if (forbidden) return forbidden;
    const relatedAllowed = await relatedResourcesBelongToProject(project.scope, [
      { entityType: "customer", entityId: body.customerId },
      { entityType: "poc_project", entityId: body.pocProjectId },
      { entityType: "opportunity", entityId: body.opportunityId },
    ]);
    if (!relatedAllowed) {
      return createApiErrorResponse(API_ERRORS.NOT_FOUND());
    }
    const document = await generateProposal({
      ...body,
      projectSlug: project.scope.projectSlug,
    });
    return createApiResponse({ document }, 201);
  } catch (error) {
    console.error("[api] generate_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
