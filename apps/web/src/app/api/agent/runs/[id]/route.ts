import { agentRunStore } from "@/lib/agent/run-store";

export const dynamic = "force-dynamic";

/** GET /api/agent/runs/:id — a single run with its full step trace. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = agentRunStore.get(id);
  if (!run) return Response.json({ error: "run not found" }, { status: 404 });
  return Response.json({ run });
}
