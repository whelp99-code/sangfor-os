import {
  createKnowledgeDocument,
  listKnowledgeDocuments,
  searchKnowledgeWithCitations,
} from "@sangfor/business/knowledge-search";
import { NextResponse } from "next/server";

import {
  getLightRagStatus,
  ingestLightRagText,
  queryLightRag,
} from "@/lib/knowledge/lightrag-client";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const status = searchParams.get("status");
  try {
    if (status === "1") {
      const lightrag = await getLightRagStatus();
      return NextResponse.json({ lightrag });
    }

    if (q) {
      const fallback = async () =>
        searchKnowledgeWithCitations({
          q,
          projectSlug: "demo-project",
        });
      let fallbackReason: string | undefined;

      if (process.env.KNOWLEDGE_BACKEND === "lightrag") {
        try {
          const lightrag = await queryLightRag(q);
          if (lightrag) {
            return NextResponse.json(lightrag);
          }
          fallbackReason = "lightrag_not_configured_or_empty";
        } catch (error) {
          fallbackReason =
            error instanceof Error ? error.message : "lightrag_failed";
          // LightRAG is optional; keep the existing database search as the reliable fallback.
        }
      }

      const citations = await fallback();
      return NextResponse.json({ citations, backend: "db", fallbackReason });
    }
    const documents = await listKnowledgeDocuments();
    return NextResponse.json({ documents });
  } catch (error) {
    return apiError("search_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const document = await createKnowledgeDocument(body);
    try {
      await ingestLightRagText(
        `${document.title}\n\n${document.body}`,
        `aios-${document.source}-${document.id}.txt`,
      );
    } catch {
      // Ingest is deliberately best-effort so document creation remains stable.
    }
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
