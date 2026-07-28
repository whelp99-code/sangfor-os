import {
  addPocEvent,
  addPocIssue,
  addPocRequirement,
  archivePocProject,
  generatePocResultReport,
  getPocDetail,
  togglePocChecklistItem,
  updatePocIssue,
  updatePocProject,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import {
  isResourceInProject,
  relatedResourcesBelongToProject,
  resolveProjectScope,
} from "@/lib/project-scope";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const projectScope = await resolveProjectScope(request);
  if (!projectScope.ok) return projectScope.response;
  const { id } = await context.params;
  try {
    const project = await getPocDetail(id);
    if (!isResourceInProject(project, projectScope.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/poc/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const projectScope = await resolveProjectScope(request);
  if (!projectScope.ok) return projectScope.response;
  const { id } = await context.params;
  try {
    const existing = await getPocDetail(id);
    if (!isResourceInProject(existing, projectScope.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json();
    const action = body.action as string | undefined;

    const relatedAllowed = await relatedResourcesBelongToProject(projectScope.scope, [
      { entityType: "customer", entityId: body.customerId },
      { entityType: "partner", entityId: body.partnerId },
    ]);
    if (!relatedAllowed) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (action === "toggle_checklist") {
      if (!existing?.checklistItems.some((item) => item.id === body.itemId)) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const item = await togglePocChecklistItem(body.itemId, Boolean(body.done));
      return NextResponse.json({ item });
    }
    if (action === "add_issue") {
      const issue = await addPocIssue(id, body.title, body.severity);
      return NextResponse.json({ issue }, { status: 201 });
    }
    if (action === "update_issue") {
      if (!existing?.issues.some((issue) => issue.id === body.issueId)) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const issue = await updatePocIssue(body.issueId, {
        status: body.status,
        severity: body.severity,
        title: body.title,
      });
      return NextResponse.json({ issue });
    }
    if (action === "add_requirement") {
      const requirement = await addPocRequirement(id, {
        label: body.label,
        details: body.details,
      });
      return NextResponse.json({ requirement }, { status: 201 });
    }
    if (action === "add_event") {
      const event = await addPocEvent(id, {
        eventType: body.eventType,
        summary: body.summary,
        occurredAt: body.occurredAt,
      });
      return NextResponse.json({ event }, { status: 201 });
    }
    if (action === "generate_report") {
      const report = await generatePocResultReport(id);
      return NextResponse.json({ report }, { status: 201 });
    }

    if (action) {
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }

    const project = await updatePocProject(id, body);
    return NextResponse.json({ project });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/poc/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const projectScope = await resolveProjectScope(request);
  if (!projectScope.ok) return projectScope.response;
  const { id } = await context.params;
  try {
    const existing = await getPocDetail(id);
    if (!isResourceInProject(existing, projectScope.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const project = await archivePocProject(id);
    return NextResponse.json({ project });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
