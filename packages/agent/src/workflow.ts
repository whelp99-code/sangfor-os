/**
 * @sangfor/agent — cross-service autonomous workflow runner (Track D phase 5).
 *
 * Orchestrates higher-level service capabilities (engineer-console analyze /
 * generate-config-plan) plus LLM verification through a deterministic, staged
 * pipeline with a human approval gate before any mutating "apply" stage.
 *
 * The runner is dependency-injected (each stage carries its own execute fn), so
 * it is fully unit-testable without services or an LLM.
 */

import { extractJsonObject } from "./json-extract";
import type { LlmComplete } from "./types";

export type WorkflowStageKind = "service" | "agent" | "approval";
export type StageStatus = "completed" | "blocked" | "error" | "skipped";

export interface StageContext {
  /** Outputs of completed stages, keyed by stage id. */
  outputs: Record<string, unknown>;
}

export interface StageDef {
  id: string;
  title: string;
  kind: WorkflowStageKind;
  /** Required for non-approval stages. Receives prior outputs via ctx. */
  execute?: (ctx: StageContext) => Promise<unknown>;
}

export interface StageResult {
  id: string;
  title: string;
  kind: WorkflowStageKind;
  status: StageStatus;
  output?: unknown;
  error?: string;
  latencyMs?: number;
}

export interface WorkflowRunResult {
  id: string;
  title: string;
  status: "completed" | "blocked" | "error";
  stages: StageResult[];
  /** Set when status === "blocked": the approval stage id awaiting sign-off. */
  awaitingApproval?: string;
}

export interface RunWorkflowOptions {
  id: string;
  title: string;
  stages: StageDef[];
  /** Ids of approval stages that have been signed off (resume after approval). */
  approvals?: string[];
  onStage?: (stage: StageResult) => void;
  now?: () => number;
}

/** Execute workflow stages sequentially, pausing at unapproved approval gates. */
export async function runWorkflow(opts: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const { id, title, stages, approvals = [], onStage, now = () => Date.now() } = opts;
  const ctx: StageContext = { outputs: {} };
  const results: StageResult[] = [];

  const record = (stage: StageResult) => {
    results.push(stage);
    onStage?.(stage);
  };

  for (const stage of stages) {
    if (stage.kind === "approval") {
      if (approvals.includes(stage.id)) {
        ctx.outputs[stage.id] = { approved: true };
        record({ id: stage.id, title: stage.title, kind: stage.kind, status: "completed", output: { approved: true } });
        continue;
      }
      record({ id: stage.id, title: stage.title, kind: stage.kind, status: "blocked" });
      return { id, title, status: "blocked", stages: results, awaitingApproval: stage.id };
    }

    const started = now();
    try {
      const output = stage.execute ? await stage.execute(ctx) : undefined;
      ctx.outputs[stage.id] = output;
      record({
        id: stage.id,
        title: stage.title,
        kind: stage.kind,
        status: "completed",
        output,
        latencyMs: now() - started,
      });
    } catch (error) {
      record({
        id: stage.id,
        title: stage.title,
        kind: stage.kind,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        latencyMs: now() - started,
      });
      return { id, title, status: "error", stages: results };
    }
  }

  return { id, title, status: "completed", stages: results };
}

export interface ConfigAutomationDeps {
  analyzeProject: (input: Record<string, unknown>) => Promise<unknown>;
  generateConfigPlan: (input: Record<string, unknown>) => Promise<unknown>;
  /** Mutating apply step — only reached after approval. Optional. */
  applyConfig?: (input: Record<string, unknown>) => Promise<unknown>;
  llm: LlmComplete;
}

/**
 * Canonical cross-service workflow:
 *   analyze-project → generate-config-plan → LLM verify → approval → apply
 */
export function buildConfigAutomationWorkflow(input: {
  requirements: string;
  deps: ConfigAutomationDeps;
}): { id: string; title: string; stages: StageDef[] } {
  const { requirements, deps } = input;
  return {
    id: "config-automation",
    title: "Sangfor 구성 자동화",
    stages: [
      {
        id: "analyze",
        title: "프로젝트 분석",
        kind: "service",
        execute: () => deps.analyzeProject({ requirements }),
      },
      {
        id: "plan",
        title: "구성안 생성",
        kind: "service",
        execute: (ctx) => deps.generateConfigPlan({ requirements, analysis: ctx.outputs.analyze }),
      },
      {
        id: "verify",
        title: "구성안 검증 (LLM)",
        kind: "agent",
        execute: async (ctx) => {
          const raw = await deps.llm([
            {
              role: "system",
              content:
                'You are a Sangfor configuration reviewer. Respond ONLY with JSON: {"risk":"low|medium|high","issues":["..."],"summary":"..."}.',
            },
            {
              role: "user",
              content: `Requirements:\n${requirements}\n\nProposed config plan:\n${JSON.stringify(ctx.outputs.plan)}`,
            },
          ]);
          return extractJsonObject(raw);
        },
      },
      { id: "approval", title: "적용 승인", kind: "approval" },
      {
        id: "apply",
        title: "구성 적용",
        kind: "service",
        execute: (ctx) =>
          deps.applyConfig
            ? deps.applyConfig({ plan: ctx.outputs.plan })
            : Promise.resolve({ applied: false, note: "applyConfig not configured" }),
      },
    ],
  };
}
