import { createPartner, listPartners } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { enforceRequestedProject, resolveProjectScope } from "@/lib/project-scope";

export async function GET(request: Request) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  try {
    const partners = await listPartners(project.scope.projectSlug);
    return NextResponse.json({ partners });
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
    const partner = await createPartner({ ...body, projectSlug: project.scope.projectSlug });
    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
