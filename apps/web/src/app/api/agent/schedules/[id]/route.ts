import { scheduleStore } from "@/lib/agent/schedule-store";
import { assertApiAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** PATCH /api/agent/schedules/:id — Body: { enabled?, intervalMinutes? } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const { id } = await params;
  let body: { enabled?: unknown; intervalMinutes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const updated = scheduleStore.update(id, {
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    intervalMinutes: typeof body.intervalMinutes === "number" ? body.intervalMinutes : undefined,
  });
  if (!updated) return Response.json({ error: "schedule not found" }, { status: 404 });
  return Response.json({ schedule: updated });
}

/** DELETE /api/agent/schedules/:id */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const { id } = await params;
  const removed = scheduleStore.remove(id);
  if (!removed) return Response.json({ error: "schedule not found" }, { status: 404 });
  return Response.json({ ok: true });
}
