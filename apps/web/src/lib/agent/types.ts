import type { AgentStatus, AgentStep } from "@sangfor/agent";

export type RunSource = "manual" | "playbook" | "schedule";

/** A persisted agent run (header + accumulated steps). */
export interface AgentRunRecord {
  id: string;
  goal: string;
  /** "running" while in-flight, then the terminal AgentStatus. */
  status: "running" | AgentStatus;
  allowUnsafe: boolean;
  maxSteps?: number;
  steps: AgentStep[];
  answer?: string;
  blockedTool?: string;
  blockedArguments?: Record<string, unknown>;
  error?: string;
  source: RunSource;
  playbookId?: string;
  createdAt: string;
  finishedAt?: string;
}

/** A reusable saved goal (one-click run). */
export interface Playbook {
  id: string;
  name: string;
  goal: string;
  allowUnsafe: boolean;
  maxSteps?: number;
  createdAt: string;
}

/** An interval schedule that runs a playbook. */
export interface Schedule {
  id: string;
  playbookId: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
}
