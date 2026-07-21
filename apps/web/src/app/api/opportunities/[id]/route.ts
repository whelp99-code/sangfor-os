import {
  addOpportunityLink,
  advanceOpportunityStage,
  archiveOpportunity,
  convertOpportunityToProject,
  getOpportunityDetail,
  promoteMeetingThreads,
  removeOpportunityLink,
  updateOpportunity,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";
import { syncCalendarMeetings } from "@/lib/outlook";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
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
    const opportunity = await getOpportunityDetail(id);
    if (!isResourceInProject(opportunity, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/opportunities/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;

  const { id } = await context.params;
  try {
    const existing = await getOpportunityDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json();

    const relatedAllowed = await relatedResourcesBelongToProject(project.scope, [
      { entityType: "customer", entityId: body.customerId },
      { entityType: "partner", entityId: body.partnerId },
    ]);
    if (!relatedAllowed) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (body.action === "advance") {
      const opportunity = await advanceOpportunityStage(id, body.expectedUpdatedAt);
      return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
    }

    if (body.action === "add_link") {
      const linkAllowed = await relatedResourcesBelongToProject(project.scope, [
        { entityType: body.entityType, entityId: body.entityId },
      ]);
      if (!linkAllowed) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const link = await addOpportunityLink(id, {
        entityType: body.entityType,
        entityId: body.entityId,
        linkType: body.linkType,
      });
      return NextResponse.json({ link }, { status: 201 });
    }

    if (body.action === "remove_link") {
      if (!existing?.links.some((link) => link.id === body.linkId)) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      await removeOpportunityLink(body.linkId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "convert_to_project") {
      // Surface mail-derived meeting threads first so the conversion absorbs them.
      await promoteMeetingThreads({ opportunityId: id });
      // Best-effort: pull Outlook calendar meetings for this deal too (skip if not connected).
      try {
        await syncCalendarMeetings({ opportunityId: id });
      } catch {
        /* calendar optional — proceed with conversion regardless */
      }
      const result = await convertOpportunityToProject({
        opportunityId: id,
        name: body.name,
        force: body.force,
        // Forward absorb selection when provided; the service applies its own
        // per-field defaults (proposals/poc/quotes/meetings) for anything omitted.
        ...(body.absorb !== undefined ? { absorb: body.absorb } : {}),
      });
      return NextResponse.json(serializeDecimalAtBoundary(result), { status: result.created ? 201 : 200 });
    }

    const opportunity = await updateOpportunity(id, body);
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    if (raw.startsWith("registration_gate:")) {
      return apiError(raw.slice("registration_gate:".length), error, { status: 409 });
    }
    if (raw === "cannot_advance_stage") {
      return apiError("cannot_advance_stage", error, { status: 409 });
    }
    if (raw === "opportunity_conflict") {
      return apiError("opportunity_conflict", error, { status: 409 });
    }
    if (raw.startsWith("illegal_stage_transition:")) {
      return apiError(raw.slice("illegal_stage_transition:".length), error, { status: 409 });
    }
    if (raw.startsWith("No confirmed POC")) {
      return apiError("conversion_requires_poc", error, {
        status: 409,
        message: "확정된 POC를 연결하거나 승인 후 강제 전환해 주세요.",
      });
    }
    if (raw.startsWith("Opportunity stage") && raw.includes("is not convertible")) {
      return apiError("conversion_stage_not_ready", error, {
        status: 409,
        message: "제안 이후 단계에서 프로젝트로 전환할 수 있습니다.",
      });
    }
    return apiError("update_failed", error, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/opportunities/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;

  const { id } = await context.params;
  try {
    const existing = await getOpportunityDetail(id);
    if (!isResourceInProject(existing, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const opportunity = await archiveOpportunity(id);
    return NextResponse.json({ opportunity });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
