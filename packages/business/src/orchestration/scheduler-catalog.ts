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

export interface ScheduledJobExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  errorCode?: string;
}

export type ExecuteScheduledHandler = (input: { handlerKey: string; payload: unknown }) => Promise<ScheduledJobExecutionResult>;

export async function executeScheduledJobTick(input: {
  jobKey: string;
  payload: unknown;
  executeHandler?: ExecuteScheduledHandler;
}) {
  const job = SYSTEM_SCHEDULED_JOBS.find((entry) => entry.jobKey === input.jobKey);
  if (!job) return { status: "FAILED" as const, errorCode: "job_not_in_catalog" };
  if (!input.executeHandler) return { status: "FAILED" as const, errorCode: "execution_adapter_not_configured" };

  try {
    const result = await input.executeHandler({ handlerKey: job.handlerKey, payload: input.payload });
    return result.success
      ? { status: "SUCCEEDED" as const, result: result.result }
      : { status: "FAILED" as const, error: result.error, errorCode: result.errorCode ?? "handler_failed" };
  } catch {
    return { status: "FAILED" as const, errorCode: "handler_threw" };
  }
}
