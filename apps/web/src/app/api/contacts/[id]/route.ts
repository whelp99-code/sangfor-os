import { archiveContact, getContactDetail, updateContact } from "@sangfor/business";
import { NextResponse } from "next/server";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { isResourceInProject, resolveProjectScope } from "@/lib/project-scope";

type RouteContext = { params: Promise<{ id: string }> };

async function resolveScopedContact(request: Request, context: RouteContext) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project;
  const { id } = await context.params;
  const contact = await getContactDetail(id);
  if (!isResourceInProject(contact, project.scope)) {
    return { ok: false as const, response: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  return { ok: true as const, id, contact };
}

export async function GET(request: Request, context: RouteContext) {
  const scoped = await resolveScopedContact(request, context);
  if (!scoped.ok) return scoped.response;
  return NextResponse.json({ contact: scoped.contact });
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/contacts/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const scoped = await resolveScopedContact(request, context);
  if (!scoped.ok) return scoped.response;
  try {
    const contact = await updateContact(scoped.id, await request.json());
    return NextResponse.json({ contact });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/contacts/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const scoped = await resolveScopedContact(request, context);
  if (!scoped.ok) return scoped.response;
  try {
    const contact = await archiveContact(scoped.id);
    return NextResponse.json({ contact });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
