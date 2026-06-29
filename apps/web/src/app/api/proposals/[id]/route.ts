import {
  archiveProposal,
  getGeneratedDocumentDetail,
  saveDocumentVersion,
} from "@sangfor/business";
import { NextResponse } from "next/server";

import { buildProposalActionGuards } from "@/lib/proposal-action-guards";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const document = await getGeneratedDocumentDetail(id);
    if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({
      document,
      actionGuards: buildProposalActionGuards(document.status),
    });
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
    if (typeof body.bodyMarkdown !== "string") {
      return NextResponse.json({ error: "bodyMarkdown_required" }, { status: 400 });
    }
    const document = await saveDocumentVersion(id, body.bodyMarkdown);
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "update_failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const document = await archiveProposal(id);
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "archive_failed" },
      { status: 400 },
    );
  }
}
