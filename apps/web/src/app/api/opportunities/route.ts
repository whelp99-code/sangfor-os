import { createOpportunity, listOpportunities } from "@sangfor/business";
import { NextResponse } from "next/server";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import {
  enforceRequestedProject,
  relatedResourcesBelongToProject,
  resolveProjectScope,
} from "@/lib/project-scope";

export async function GET(request: Request) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  try {
    const opportunities = await listOpportunities(project.scope.projectSlug);
    return NextResponse.json({ opportunities: serializeDecimalAtBoundary(opportunities) });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  try {
    const body = await request.json();
    const forbidden = enforceRequestedProject(project.scope, body.projectSlug);
    if (forbidden) return forbidden;
    const relatedAllowed = await relatedResourcesBelongToProject(project.scope, [
      { entityType: "customer", entityId: body.customerId },
      { entityType: "partner", entityId: body.partnerId },
    ]);
    if (!relatedAllowed) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const opportunity = await createOpportunity({
      ...body,
      projectSlug: project.scope.projectSlug,
    });
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
