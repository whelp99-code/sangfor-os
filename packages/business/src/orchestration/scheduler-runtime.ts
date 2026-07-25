import type { AuthContext } from "@sangfor/auth";
import { executeScheduledJobTick, SYSTEM_SCHEDULED_JOBS } from "./scheduler-catalog";

export class SchedulerRuntimeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SchedulerRuntimeError";
    this.code = code;
  }
}

export async function listScheduledJobs(input: { authContext: AuthContext }) {
  return SYSTEM_SCHEDULED_JOBS.map((job) => ({
    ...job,
    enabled: true,
    lastRunAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() + 86400000).toISOString(),
  }));
}

export async function triggerScheduledJob(input: { authContext: AuthContext; jobKey: string }) {
  return executeScheduledJobTick(input);
}
