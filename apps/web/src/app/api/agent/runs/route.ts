import { agentRunStore } from "@/lib/agent/run-store";

export const dynamic = "force-dynamic";

/** GET /api/agent/runs?limit=50 — recent agent runs, most recent first. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
  return Response.json({ runs: agentRunStore.list(limit) });
}
