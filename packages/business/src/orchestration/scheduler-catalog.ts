import type { AuthContext } from "@sangfor/auth";
import { getSchedulerHandler } from "./scheduler-handler-registry";

export interface ScheduledJobCatalogEntry {
  jobKey: string;
  handlerKey: string;
  scheduleKind: "interval" | "cron" | "manual";
  scheduleExpression: string;
  description: string;
}

export const SYSTEM_SCHEDULED_JOBS: ScheduledJobCatalogEntry[] = [
  { jobKey: "daily-briefing", handlerKey: "daily_briefing", scheduleKind: "cron", scheduleExpression: "0 9 * * *", description: "Daily executive summary briefing" },
  { jobKey: "kpi-weekly", handlerKey: "kpi_weekly", scheduleKind: "cron", scheduleExpression: "0 9 * * 1", description: "Weekly KPI calculation" },
];

export async function executeScheduledJobTick(input: { authContext: AuthContext; jobKey: string }) {
  const { jobKey } = input;
  const job = SYSTEM_SCHEDULED_JOBS.find((j) => j.jobKey === jobKey);
  if (!job) throw new Error(`Job not found in catalog: ${jobKey}`);

  const handler = getSchedulerHandler(job.handlerKey);
  if (!handler) return { status: "FAILED", errorCode: "handler_not_registered", runId: `run-${Date.now()}` };

  const res = await handler({});
  return { status: res.success ? "SUCCEEDED" : "FAILED", result: res.result, error: res.error, runId: `run-${Date.now()}` };
}
