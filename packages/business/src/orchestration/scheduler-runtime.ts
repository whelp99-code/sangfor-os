import type { AuthContext } from "@sangfor/auth";
import { withRlsTransaction } from "@sangfor/db";
import { executeScheduledJobTick, SYSTEM_SCHEDULED_JOBS, type ExecuteScheduledHandler } from "./scheduler-catalog";

export class SchedulerRuntimeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SchedulerRuntimeError";
    this.code = code;
  }
}

function scope(authContext: AuthContext) {
  return { tenantId: authContext.tenantId, companyId: authContext.companyId, projectId: authContext.projectId };
}

export async function listScheduledJobs(input: { authContext: AuthContext }) {
  return withRlsTransaction(scope(input.authContext), async (tx) => {
    const persisted = await tx.schedulerJob.findMany({
      where: { companyId: input.authContext.companyId, OR: [{ projectId: input.authContext.projectId }, { projectId: null }] },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const byKey = new Map(persisted.map((job) => [job.jobKey, job]));

    return SYSTEM_SCHEDULED_JOBS.map((job) => {
      const stored = byKey.get(job.jobKey);
      const latestRun = stored?.runs[0];
      return {
        ...job,
        persistedJobId: stored?.id ?? null,
        enabled: stored?.enabled ?? null,
        lastRunAt: stored?.lastRunAt?.toISOString() ?? null,
        nextRunAt: stored?.nextRunAt?.toISOString() ?? null,
        latestRun: latestRun ? {
          runId: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt?.toISOString() ?? null,
          finishedAt: latestRun.finishedAt?.toISOString() ?? null,
          errorCode: latestRun.errorCode,
        } : null,
        evidenceState: stored ? "PERSISTED" as const : "UNKNOWN" as const,
      };
    });
  });
}

export async function triggerScheduledJob(input: {
  authContext: AuthContext;
  jobKey: string;
  executeHandler?: ExecuteScheduledHandler;
}) {
  const scheduledFor = new Date();
  const persisted = await withRlsTransaction(scope(input.authContext), async (tx) => {
    const job = await tx.schedulerJob.findFirst({
      where: { companyId: input.authContext.companyId, jobKey: input.jobKey, OR: [{ projectId: input.authContext.projectId }, { projectId: null }] },
    });
    if (!job) return null;
    if (!job.enabled) return { disabled: true as const, job };
    const run = await tx.schedulerRun.create({
      data: {
        jobId: job.id,
        scheduledFor,
        idempotencyKey: `manual:${job.id}:${scheduledFor.toISOString()}`,
        status: "RUNNING",
        attemptCount: 1,
        startedAt: scheduledFor,
      },
    });
    return { disabled: false as const, job, run };
  });

  if (!persisted) return { status: "FAILED" as const, errorCode: "job_not_persisted", runId: null };
  if (persisted.disabled) return { status: "FAILED" as const, errorCode: "job_disabled", runId: null };

  const execution = await executeScheduledJobTick({
    jobKey: input.jobKey,
    payload: persisted.job.payloadJson,
    executeHandler: input.executeHandler,
  });
  const finishedAt = new Date();

  await withRlsTransaction(scope(input.authContext), async (tx) => {
    await tx.schedulerRun.update({
      where: { id: persisted.run.id },
      data: {
        status: execution.status,
        finishedAt,
        resultJson: execution.status === "SUCCEEDED" && execution.result !== undefined
          ? JSON.parse(JSON.stringify(execution.result))
          : undefined,
        errorCode: execution.status === "FAILED" ? execution.errorCode : null,
      },
    });
    await tx.schedulerJob.update({ where: { id: persisted.job.id }, data: { lastRunAt: finishedAt } });
  });

  return { ...execution, runId: persisted.run.id, startedAt: scheduledFor.toISOString(), finishedAt: finishedAt.toISOString() };
}
