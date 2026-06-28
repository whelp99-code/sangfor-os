import type { AgentRunResult, AgentStep } from "@sangfor/agent";

import type { AgentRunRecord, RunSource } from "./types";

const MAX_HISTORY = 100;

/**
 * In-memory store for agent runs. Survives HMR via a globalThis singleton.
 * Designed to be swappable for a DB/Redis-backed store later — the route
 * handlers only depend on this interface.
 */
export class AgentRunStore {
  private runs = new Map<string, AgentRunRecord>();
  private order: string[] = []; // most-recent last

  create(input: {
    goal: string;
    allowUnsafe: boolean;
    maxSteps?: number;
    source?: RunSource;
    playbookId?: string;
  }): AgentRunRecord {
    const record: AgentRunRecord = {
      id: crypto.randomUUID(),
      goal: input.goal,
      status: "running",
      allowUnsafe: input.allowUnsafe,
      maxSteps: input.maxSteps,
      steps: [],
      source: input.source ?? "manual",
      playbookId: input.playbookId,
      createdAt: new Date().toISOString(),
    };
    this.runs.set(record.id, record);
    this.order.push(record.id);
    this.evict();
    return record;
  }

  appendStep(id: string, step: AgentStep): void {
    const record = this.runs.get(id);
    if (record) record.steps.push(step);
  }

  finish(id: string, result: Partial<AgentRunResult> & { error?: string }): void {
    const record = this.runs.get(id);
    if (!record) return;
    record.status = result.status ?? "error";
    record.answer = result.answer;
    record.blockedTool = result.blockedTool;
    record.blockedArguments = result.blockedArguments;
    record.error = result.error;
    record.finishedAt = new Date().toISOString();
  }

  get(id: string): AgentRunRecord | undefined {
    return this.runs.get(id);
  }

  list(limit = 50): AgentRunRecord[] {
    return this.order
      .slice(-limit)
      .reverse()
      .map((id) => this.runs.get(id))
      .filter((r): r is AgentRunRecord => Boolean(r));
  }

  private evict(): void {
    while (this.order.length > MAX_HISTORY) {
      const oldest = this.order.shift();
      if (oldest) this.runs.delete(oldest);
    }
  }
}

type GlobalWithStore = typeof globalThis & { __sangforAgentRunStore?: AgentRunStore };

export const agentRunStore: AgentRunStore = (() => {
  const g = globalThis as GlobalWithStore;
  g.__sangforAgentRunStore ??= new AgentRunStore();
  return g.__sangforAgentRunStore;
})();
