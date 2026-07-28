import { playbookStore } from "@/lib/agent/playbook-store";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

/** DELETE /api/agent/playbooks/:id */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/agent/playbooks/[id]/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const { id } = await params;
  const removed = await playbookStore.remove(id);
  if (!removed) return Response.json({ error: "playbook not found" }, { status: 404 });
  return Response.json({ ok: true });
}
