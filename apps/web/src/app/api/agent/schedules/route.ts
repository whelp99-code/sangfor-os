import { playbookStore } from "@/lib/agent/playbook-store";
import { scheduleStore } from "@/lib/agent/schedule-store";
import { assertApiAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** GET /api/agent/schedules — list schedules (joined with playbook name). */
export async function GET() {
  const playbooks = await playbookStore.list();
  const nameById = new Map(playbooks.map((p) => [p.id, p.name]));
  const schedules = scheduleStore.list().map((s) => ({
    ...s,
    playbookName: nameById.get(s.playbookId) ?? "(deleted playbook)",
  }));
  return Response.json({ schedules });
}

/** POST /api/agent/schedules — Body: { playbookId, intervalMinutes, enabled? } */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  let body: { playbookId?: unknown; intervalMinutes?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const playbookId = typeof body.playbookId === "string" ? body.playbookId : "";
  const intervalMinutes = typeof body.intervalMinutes === "number" ? body.intervalMinutes : 0;
  if (!playbookId || !(await playbookStore.get(playbookId))) {
    return Response.json({ error: "valid playbookId is required" }, { status: 400 });
  }
  if (!(intervalMinutes > 0)) {
    return Response.json({ error: "intervalMinutes must be > 0" }, { status: 400 });
  }
  const schedule = scheduleStore.create({
    playbookId,
    intervalMinutes,
    enabled: body.enabled !== false,
  });
  return Response.json({ schedule }, { status: 201 });
}
