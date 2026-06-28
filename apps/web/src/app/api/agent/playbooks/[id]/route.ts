import { playbookStore } from "@/lib/agent/playbook-store";

export const dynamic = "force-dynamic";

/** DELETE /api/agent/playbooks/:id */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const removed = playbookStore.remove(id);
  if (!removed) return Response.json({ error: "playbook not found" }, { status: 404 });
  return Response.json({ ok: true });
}
