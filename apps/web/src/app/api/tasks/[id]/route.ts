import { archiveWorkTask, getWorkTaskDetail, linkTaskToEntity, updateWorkTask } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const task = await getWorkTaskDetail(id);
    if (!task) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ task });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;

  const { id } = await context.params;
  try {
    const body = await request.json();
    if (body.entityType && body.entityId) {
      const link = await linkTaskToEntity(id, body);
      return NextResponse.json({ link });
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

  const { id } = await context.params;
  try {
    const task = await archiveWorkTask(id);
    return NextResponse.json({ task });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
