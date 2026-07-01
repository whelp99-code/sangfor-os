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
import { syncCalendarMeetings } from "@/lib/outlook-graph";
import { apiError, assertApiAccess } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const opportunity = await getOpportunityDetail(id);
    if (!opportunity) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
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

    if (body.action === "advance") {
      const opportunity = await advanceOpportunityStage(id);
      return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
    }

    if (body.action === "add_link") {
      const link = await addOpportunityLink(id, {
        entityType: body.entityType,
        entityId: body.entityId,
        linkType: body.linkType,
      });
      return NextResponse.json({ link }, { status: 201 });
    }

    if (body.action === "remove_link") {
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
    return apiError("update_failed", error, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;

  const { id } = await context.params;
  try {
    const opportunity = await archiveOpportunity(id);
    return NextResponse.json({ opportunity });
  } catch (error) {
    return apiError("archive_failed", error, { status: 400 });
  }
}
