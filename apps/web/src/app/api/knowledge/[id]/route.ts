import {
  getKnowledgeDocument,
  updateKnowledgeDocument,
} from "@sangfor/business/knowledge-search";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const document = await getKnowledgeDocument(id);
    if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ document });
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
    const document = await updateKnowledgeDocument(id, body);
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "update_failed" },
      { status: 400 },
    );
  }
}
