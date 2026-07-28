import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ withRlsTransaction: vi.fn() }));
vi.mock("@sangfor/db", () => ({ withRlsTransaction: mocks.withRlsTransaction }));

import { listScheduledJobs, triggerScheduledJob } from "./scheduler-runtime";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "system_admin", permissions: [], product: "portal",
};

describe("U069: scheduler-runtime unit tests", () => {
  const tx = {
    schedulerJob: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    schedulerRun: { create: vi.fn(), update: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withRlsTransaction.mockImplementation(async (_scope: unknown, callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    tx.schedulerJob.findMany.mockResolvedValue([]);
    tx.schedulerJob.findFirst.mockResolvedValue(null);
  });

  it("reports unknown timestamps and enablement without a persisted job", async () => {
    const jobs = await listScheduledJobs({ authContext: CTX });
    expect(jobs[0]).toMatchObject({ jobKey: "daily-briefing", enabled: null, lastRunAt: null, nextRunAt: null, evidenceState: "UNKNOWN" });
  });

  it("persists an injected handler result as the scheduler run evidence", async () => {
    tx.schedulerJob.findFirst.mockResolvedValue({ id: "job-1", enabled: true, payloadJson: { report: "daily" } });
    tx.schedulerRun.create.mockResolvedValue({ id: "run-1" });
    tx.schedulerRun.update.mockResolvedValue({ id: "run-1" });
    tx.schedulerJob.update.mockResolvedValue({ id: "job-1" });

    const result = await triggerScheduledJob({
      authContext: CTX,
      jobKey: "daily-briefing",
      executeHandler: vi.fn(async () => ({ success: true, result: { receiptId: "receipt-1" } })),
    });

    expect(result).toMatchObject({ status: "SUCCEEDED", runId: "run-1", result: { receiptId: "receipt-1" } });
    expect(tx.schedulerRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SUCCEEDED", resultJson: { receiptId: "receipt-1" } }),
    }));
  });

  it("fails closed when the catalog job is not persisted", async () => {
    await expect(triggerScheduledJob({ authContext: CTX, jobKey: "daily-briefing" })).resolves.toMatchObject({
      status: "FAILED", errorCode: "job_not_persisted", runId: null,
    });
  });
});
