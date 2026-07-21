import {
  getKnowledgeDocument,
  updateKnowledgeDocument,
} from "@sangfor/business/knowledge-search";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const document = await getKnowledgeDocument(id);
    if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ document });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/knowledge/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const { id } = await context.params;
  try {
    const body = await request.json();
    const document = await updateKnowledgeDocument(id, body);
    return NextResponse.json({ document });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}
