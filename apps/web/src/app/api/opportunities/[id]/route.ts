import {
  addOpportunityLink,
  advanceOpportunityStage,
  getOpportunityDetail,
  removeOpportunityLink,
  updateOpportunity,
} from "@ai-portal/automation";
import { NextResponse } from "next/server";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const opportunity = await getOpportunityDetail(id);
    if (!opportunity) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fetch_failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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

    const opportunity = await updateOpportunity(id, body);
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "update_failed" },
      { status: 400 },
    );
  }
}
