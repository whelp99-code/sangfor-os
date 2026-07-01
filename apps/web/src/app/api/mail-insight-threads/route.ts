import {
  listMailInsightThreads,
  upsertMailInsightThreads,
} from "@sangfor/business/mail-insight-threads";
import { NextResponse } from "next/server";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { ingestLightRagText } from "@/lib/knowledge/lightrag-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "100");
  try {
    const threads = await listMailInsightThreads({
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return NextResponse.json({ threads });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const result = await upsertMailInsightThreads(body);
    for (const thread of result.threads) {
      if (!thread.knowledgeDocument) continue;
      try {
        await ingestLightRagText(
          `${thread.knowledgeDocument.title}\n\n${thread.summary}`,
          `aios-mail-thread-${thread.id}.txt`,
        );
      } catch {
        // LightRAG ingest is optional; thread persistence remains the source of truth.
      }
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError("upsert_failed", error, { status: 400 });
  }
}
