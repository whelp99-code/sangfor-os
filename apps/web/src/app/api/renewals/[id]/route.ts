import { getRenewalDetail, updateRenewal } from "@sangfor/business";
import { NextResponse } from "next/server";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { isResourceInProject, resolveProjectScope } from "@/lib/project-scope";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { id } = await context.params;
  try {
    const existing = await getRenewalDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ renewal: await updateRenewal(id, await request.json()) });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}
