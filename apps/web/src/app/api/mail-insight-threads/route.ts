import {
  listMailInsightThreads,
  upsertMailInsightThreads,
} from "@ai-portal/automation/mail-insight-threads";
import { NextResponse } from "next/server";

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "upsert_failed" },
      { status: 400 },
    );
  }
}
