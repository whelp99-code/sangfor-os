import { createPocProject, listPocProjects } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import {
  enforceRequestedProject,
  relatedResourcesBelongToProject,
  resolveProjectScope,
} from "@/lib/project-scope";

export async function GET(request: Request) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  try {
    const projects = await listPocProjects(project.scope.projectSlug);
    return NextResponse.json({ projects });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/poc/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const projectScope = await resolveProjectScope(request);
  if (!projectScope.ok) return projectScope.response;
  try {
    const body = await request.json();
    const forbidden = enforceRequestedProject(projectScope.scope, body.projectSlug);
    if (forbidden) return forbidden;
    const relatedAllowed = await relatedResourcesBelongToProject(projectScope.scope, [
      { entityType: "opportunity", entityId: body.opportunityId },
      { entityType: "customer", entityId: body.customerId },
      { entityType: "partner", entityId: body.partnerId },
    ]);
    if (!relatedAllowed) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const project = await createPocProject({
      ...body,
      projectSlug: projectScope.scope.projectSlug,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
