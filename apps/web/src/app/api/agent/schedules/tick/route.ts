import { runMcpAgent } from "@sangfor/agent";
import { INTERNAL_PRINCIPAL_HEADER, verifyInternalPrincipal } from "@sangfor/auth";
import { getInternalPrincipalConfig } from "@sangfor/config";
import { claimInternalPrincipalReplay } from "@sangfor/business";

import { agentRunStore } from "@/lib/agent/run-store";
import { playbookStore } from "@/lib/agent/playbook-store";
import { scheduleStore } from "@/lib/agent/schedule-store";
import { dueSchedules } from "@/lib/agent/schedule-logic";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/schedules/tick — run every due schedule once.
 *
 * Intended to be called by an external cron / scheduler (or the UI's
 * "Run due now" button). There is no hidden background process: due-ness is
 * computed from each schedule's nextRunAt, the matching playbook is executed,
 * the run is recorded, and nextRunAt is advanced.
 */
export async function POST(request: Request) {
  const envelope = request.headers.get(INTERNAL_PRINCIPAL_HEADER);
  let principalKind: "human" | "scheduler" = "human";
  if (envelope !== null) {
    try {
      const url = new URL(request.url);
      const principal = verifyInternalPrincipal(envelope, {
        profile: "SCHEDULER", method: "POST", path: url.pathname, query: url.search, body: "",
      }, getInternalPrincipalConfig());
      await claimInternalPrincipalReplay({
        profile: principal.profile, subjectId: principal.subjectId, tenantId: principal.tenantId, companyId: principal.companyId, projectId: principal.projectId,
        jti: principal.jti, nonce: principal.nonce, idempotencyKey: principal.idempotencyKey,
      });
      principalKind = "scheduler";
    } catch {
      return Response.json({ error: "INVALID_INTERNAL_PRINCIPAL" }, { status: 401 });
    }
  } else {
    // A UI/operator trigger stays on the existing authenticated-human path;
    // it is never silently reclassified as an automation principal.
    const denied = assertApiAccess(request);
    if (denied) return denied;
    const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/agent/schedules/tick/route.ts");
    if (capabilityDenied) return capabilityDenied;
  }
  const now = Date.now();
  const due = dueSchedules(scheduleStore.list(), now);
  const triggered: Array<{ scheduleId: string; playbookId: string; runId?: string; status: string }> = [];

  for (const schedule of due) {
    const playbook = await playbookStore.get(schedule.playbookId);
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
      // Sanitize: log the real cause server-side, persist only a stable code
      // (the run record's error is client-readable via /api/agent/runs).
      console.error("[api] schedule_run_failed:", error instanceof Error ? error.stack ?? error.message : error);
      agentRunStore.finish(record.id, { status: "error", error: "schedule_run_failed" });
      triggered.push({ scheduleId: schedule.id, playbookId: playbook.id, runId: record.id, status: "error" });
    }

    scheduleStore.markRan(schedule.id, now);
  }

  return Response.json({ triggered, count: triggered.length, at: new Date(now).toISOString(), principal: principalKind });
}
