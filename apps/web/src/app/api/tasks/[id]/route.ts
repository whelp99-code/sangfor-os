import { archiveWorkTask, getWorkTaskDetail, linkTaskToEntity, updateWorkTask } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import {
  isResourceInProject,
  relatedResourcesBelongToProject,
  resolveProjectScope,
} from "@/lib/project-scope";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { id } = await context.params;
  try {
    const task = await getWorkTaskDetail(id);
    if (!isResourceInProject(task, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;

  const { id } = await context.params;
  try {
    const existing = await getWorkTaskDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json();
    if (body.entityType && body.entityId) {
      const linkAllowed = await relatedResourcesBelongToProject(project.scope, [
        { entityType: body.entityType, entityId: body.entityId },
      ]);
      if (!linkAllowed) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const link = await linkTaskToEntity(id, body);
      return NextResponse.json({ link });
    }
    const relatedAllowed = await relatedResourcesBelongToProject(project.scope, [
      { entityType: "customer", entityId: body.customerId },
      { entityType: "partner", entityId: body.partnerId },
      { entityType: "engagement", entityId: body.engagementId },
    ]);
    if (!relatedAllowed) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const task = await updateWorkTask(id, body);
    return NextResponse.json({ task });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;

  const { id } = await context.params;
  try {
    const existing = await getWorkTaskDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const task = await archiveWorkTask(id);
    return NextResponse.json({ task });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
