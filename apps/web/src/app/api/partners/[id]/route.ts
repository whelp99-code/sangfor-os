import { archivePartner, getPartnerDetail, updatePartner } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { isResourceInProject, resolveProjectScope } from "@/lib/project-scope";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { id } = await context.params;
  try {
    const partner = await getPartnerDetail(id);
    if (!isResourceInProject(partner, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ partner });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/partners/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { id } = await context.params;
  try {
    const existing = await getPartnerDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json();
    const partner = await updatePartner(id, body);
    return NextResponse.json({ partner });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/partners/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { id } = await context.params;
  try {
    const existing = await getPartnerDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const partner = await archivePartner(id);
    return NextResponse.json({ partner });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
