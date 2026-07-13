import { archiveCustomer, getCustomerDetail, updateCustomer } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { isResourceInProject, resolveProjectScope } from "@/lib/project-scope";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { id } = await context.params;
  try {
    const customer = await getCustomerDetail(id);
    if (!isResourceInProject(customer, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ customer });
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
    const existing = await getCustomerDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json();
    const customer = await updateCustomer(id, body);
    return NextResponse.json({ customer });
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
    const existing = await getCustomerDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const customer = await archiveCustomer(id);
    return NextResponse.json({ customer });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
