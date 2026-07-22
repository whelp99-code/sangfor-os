import { workflowRunStore } from "@/lib/agent/workflow-run-store";

export const dynamic = "force-dynamic";

/** @deprecated Read-only legacy namespace. Canonical persisted runs are `/api/workflow-runs`. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
  const response = Response.json({ namespace: "legacy-simulation", runs: workflowRunStore.list(limit) });
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/workflow-runs>; rel="successor-version"');
  response.headers.set("X-Workflow-Authority", "legacy-simulation");
  return response;
}
