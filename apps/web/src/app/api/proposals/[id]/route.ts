import {
  archiveProposal,
  getGeneratedDocumentDetail,
  saveDocumentVersion,
} from "@sangfor/business";
import { NextResponse } from "next/server";

import { buildProposalActionGuards } from "@/lib/proposal-action-guards";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { isResourceInProject, resolveProjectScope } from "@/lib/project-scope";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { id } = await context.params;
  try {
    const document = await getGeneratedDocumentDetail(id);
    if (!document || !isResourceInProject(document, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      document,
      actionGuards: buildProposalActionGuards(document.status),
    });
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
    const existing = await getGeneratedDocumentDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json();
    if (typeof body.bodyMarkdown !== "string") {
      return NextResponse.json({ error: "bodyMarkdown_required" }, { status: 400 });
    }
    const document = await saveDocumentVersion(id, body.bodyMarkdown);
    return NextResponse.json({ document });
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
    const existing = await getGeneratedDocumentDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const document = await archiveProposal(id);
    return NextResponse.json({ document });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
