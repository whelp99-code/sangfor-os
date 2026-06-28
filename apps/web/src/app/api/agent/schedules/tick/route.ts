import { runMcpAgent } from "@sangfor/agent";

import { agentRunStore } from "@/lib/agent/run-store";
import { playbookStore } from "@/lib/agent/playbook-store";
import { scheduleStore } from "@/lib/agent/schedule-store";
import { dueSchedules } from "@/lib/agent/schedule-logic";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/schedules/tick — run every due schedule once.
 *
 * Intended to be called by an external cron / scheduler (or the UI's
 * "Run due now" button). There is no hidden background process: due-ness is
 * computed from each schedule's nextRunAt, the matching playbook is executed,
 * the run is recorded, and nextRunAt is advanced.
 */
export async function POST() {
  const now = Date.now();
  const due = dueSchedules(scheduleStore.list(), now);
  const triggered: Array<{ scheduleId: string; playbookId: string; runId?: string; status: string }> = [];

  for (const schedule of due) {
    const playbook = playbookStore.get(schedule.playbookId);
    if (!playbook) {
      scheduleStore.markRan(schedule.id, now);
      triggered.push({ scheduleId: schedule.id, playbookId: schedule.playbookId, status: "skipped_no_playbook" });
      continue;
    }

    const record = agentRunStore.create({
      goal: playbook.goal,
      allowUnsafe: playbook.allowUnsafe,
      maxSteps: playbook.maxSteps,
      source: "schedule",
      playbookId: playbook.id,
    });

    try {
      const result = await runMcpAgent({
        goal: playbook.goal,
        allowUnsafe: playbook.allowUnsafe,
        maxSteps: playbook.maxSteps,
        onStep: (step) => agentRunStore.appendStep(record.id, step),
      });
      agentRunStore.finish(record.id, result);
      triggered.push({ scheduleId: schedule.id, playbookId: playbook.id, runId: record.id, status: result.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      agentRunStore.finish(record.id, { status: "error", error: message });
      triggered.push({ scheduleId: schedule.id, playbookId: playbook.id, runId: record.id, status: "error" });
    }

    scheduleStore.markRan(schedule.id, now);
  }

  return Response.json({ triggered, count: triggered.length, at: new Date(now).toISOString() });
}
