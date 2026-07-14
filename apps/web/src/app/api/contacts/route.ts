import { createContact } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { relatedResourcesBelongToProject, resolveProjectScope } from "@/lib/project-scope";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  try {
    const body = await request.json();
    const parentAllowed = await relatedResourcesBelongToProject(project.scope, [
      { entityType: "customer", entityId: body.customerId },
      { entityType: "partner", entityId: body.partnerId },
    ]);
    if (!parentAllowed) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const contact = await createContact(body);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
