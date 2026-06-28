import type { StageResult, WorkflowRunResult } from "@sangfor/agent";

import type { WorkflowRunRecord } from "./types";

const MAX_HISTORY = 50;

/** In-memory store for cross-service workflow runs (globalThis singleton). */
export class WorkflowRunStore {
  private runs = new Map<string, WorkflowRunRecord>();
  private order: string[] = [];

  create(input: { requirements: string; approvals?: string[] }): WorkflowRunRecord {
    const record: WorkflowRunRecord = {
      id: crypto.randomUUID(),
      requirements: input.requirements,
      status: "running",
      stages: [],
      approvals: input.approvals ?? [],
      createdAt: new Date().toISOString(),
    };
    this.runs.set(record.id, record);
    this.order.push(record.id);
    while (this.order.length > MAX_HISTORY) {
      const oldest = this.order.shift();
      if (oldest) this.runs.delete(oldest);
    }
    return record;
  }

  appendStage(id: string, stage: StageResult): void {
    const record = this.runs.get(id);
    if (record) record.stages.push(stage);
  }

  finish(id: string, result: Partial<WorkflowRunResult> & { error?: string }): void {
    const record = this.runs.get(id);
    if (!record) return;
    record.status = result.status ?? "error";
    record.awaitingApproval = result.awaitingApproval;
    record.error = result.error;
    record.finishedAt = new Date().toISOString();
  }

  get(id: string): WorkflowRunRecord | undefined {
    return this.runs.get(id);
  }

  list(limit = 20): WorkflowRunRecord[] {
    return this.order
      .slice(-limit)
      .reverse()
      .map((id) => this.runs.get(id))
      .filter((r): r is WorkflowRunRecord => Boolean(r));
  }
}

type GlobalWithStore = typeof globalThis & { __sangforWorkflowRunStore?: WorkflowRunStore };

export const workflowRunStore: WorkflowRunStore = (() => {
  const g = globalThis as GlobalWithStore;
  g.__sangforWorkflowRunStore ??= new WorkflowRunStore();
  return g.__sangforWorkflowRunStore;
})();
