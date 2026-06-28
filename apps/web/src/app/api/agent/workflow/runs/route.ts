import { workflowRunStore } from "@/lib/agent/workflow-run-store";

export const dynamic = "force-dynamic";

/** GET /api/agent/workflow/runs?limit=20 — recent workflow runs. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
  return Response.json({ runs: workflowRunStore.list(limit) });
}
