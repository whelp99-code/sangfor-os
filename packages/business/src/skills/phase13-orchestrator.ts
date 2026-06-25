import { prisma, Prisma } from "@sangfor/db";
import { z } from "zod";

import { createCommandRun, phase13SourceEntityTypeSchema } from "../command-center";
import { createApprovalIfNeeded } from "../approval-gate";
import { mapWithConcurrency } from "../map-with-concurrency";
import { normalizeSkillOutput } from "./skill-output-normalizer";
import { recommendSkills } from "./skill-router";
import { recommendAssignmentForWorkItem } from "./phase13-assignment-rules";
import { buildHandoffDraft, type HandoffDraft } from "./phase13-handoff";
import {
  resolvePhase13ExecutionProfile,
  type Phase13ExecutionProfile,
} from "./execution-profile";
import { templateKeySchema } from "../phase14/types";
import type { ContextPack, TemplateRenderOutput } from "../phase14/types";
import { runSkillWithMetadata } from "./skill-runner";
import {
  workBreakdownFromNormalizedData,
  workBreakdownFromSkillOutput,
} from "./skill-to-work-breakdown";
import type { AssignmentSuggestion } from "./phase13-assignment-rules";
import { traceWorkflowEvent } from "../langfuse-observability";

export const recommendSkillsSchema = z.object({
  inputSummary: z.string().min(3),
  module: z.string().optional(),
  phase: z.number().int().optional(),
});

export const runPhase13Schema = z
  .object({
    inputSummary: z.string().min(3),
    projectSlug: z.string().default("demo-project"),
    module: z.string().optional(),
    phase: z.number().int().optional(),
    sourceEntityType: phase13SourceEntityTypeSchema.optional(),
    sourceEntityId: z.string().min(1).optional(),
    templateKey: templateKeySchema.optional(),
    includeContextPack: z.boolean().optional(),
    executionProfile: z.enum(["full", "smoke", "minimal"]).optional(),
  })
  .refine(
    (data) =>
      (data.sourceEntityType == null && data.sourceEntityId == null) ||
      (data.sourceEntityType != null && data.sourceEntityId != null),
    { message: "sourceEntityType and sourceEntityId must be provided together" },
  );

export { phase13SourceEntityTypeSchema };

export type EnrichedWorkBreakdownItem = {
  id: string;
  commandRunId: string | null;
  skillRunId: string | null;
  title: string;
  description: string | null;
  targetArea: string;
  agentType: string;
  riskLevel: string;
  estimatedHours: number;
  sortOrder: number;
  suggestedOwner?: string;
  suggestedAgent?: AssignmentSuggestion["suggestedAgent"];
  confidence?: number;
  reason?: string;
};

export async function recommendSkillsForInput(input: z.infer<typeof recommendSkillsSchema>) {
  const parsed = recommendSkillsSchema.parse(input);
  const skillKeys = recommendSkills(parsed);
  void traceWorkflowEvent({
    event: "phase13.skillRecommendation",
    phase: parsed.phase ?? 13,
    metadata: {
      module: parsed.module ?? null,
      inputSummaryLength: parsed.inputSummary.length,
      recommendedSkillKeys: skillKeys,
    },
  });
  return { skillKeys, inputSummary: parsed.inputSummary };
}

export async function runPhase13Orchestrator(input: z.infer<typeof runPhase13Schema>) {
  const parsed = runPhase13Schema.parse(input);
  const profile = resolvePhase13ExecutionProfile(
    parsed.executionProfile as Phase13ExecutionProfile | undefined,
  );

  let effectiveInputSummary = parsed.inputSummary;
  let contextPack: ContextPack | null = null;
  let templateOutput: TemplateRenderOutput | null = null;
  let contextPackSummary: string | null = null;

  if (
    parsed.includeContextPack !== false &&
    parsed.sourceEntityType &&
    parsed.sourceEntityId
  ) {
    const { enrichPhase13RunWithContextPack } = await import("../phase14/phase14-orchestrator-bridge");
    const enriched = await enrichPhase13RunWithContextPack({
      projectSlug: parsed.projectSlug,
      sourceEntityType: parsed.sourceEntityType,
      sourceEntityId: parsed.sourceEntityId,
      templateKey: parsed.templateKey,
      inputSummary: parsed.inputSummary,
      includeContextPack: true,
    });
    effectiveInputSummary = enriched.inputSummary;
    contextPack = enriched.contextPack;
    templateOutput = enriched.templateOutput;
    contextPackSummary = enriched.contextPackSummary;
  }

  const skillKeys = recommendSkills({
    ...parsed,
    inputSummary: effectiveInputSummary,
    executionProfile: parsed.executionProfile,
  });
  void traceWorkflowEvent({
    event: "phase13.skillRecommendation",
    phase: parsed.phase ?? 13,
    metadata: {
      module: parsed.module ?? null,
      inputSummaryLength: effectiveInputSummary.length,
      recommendedSkillKeys: skillKeys,
      sourceEntityType: parsed.sourceEntityType ?? null,
      sourceEntityIdPresent: parsed.sourceEntityId != null,
      executionProfile: profile.name,
      skillConcurrency: profile.skillConcurrency,
    },
  });

  const commandRun = await createCommandRun({
    inputSummary: effectiveInputSummary,
    projectSlug: parsed.projectSlug,
    commandKey: "phase13-orchestrator",
    sourceEntityType: parsed.sourceEntityType,
    sourceEntityId: parsed.sourceEntityId,
  });

  const skillRuns = [];
  let breakdownDrafts: ReturnType<typeof workBreakdownFromNormalizedData> = [];
  let llmCallCount = 0;
  let templateCallCount = 0;
  const runStartedAt = Date.now();
  const executedRuns = await mapWithConcurrency(
    skillKeys,
    profile.skillConcurrency,
    async (skillKey, index) => {
      const startedAt = Date.now();
      const executed = await runSkillWithMetadata({
        skillKey,
        inputSummary: effectiveInputSummary,
        profile,
      });
      const durationMs = Date.now() - startedAt;
      const normalized = normalizeSkillOutput(executed.rawOutput);
      const skillRun = await prisma.skillRun.create({
        data: {
          commandRunId: commandRun.id,
          skillKey,
          status: "completed",
          executionMode: executed.executionMode,
          sortOrder: index + 1,
          rawOutputJson: executed.rawOutput as Prisma.InputJsonValue,
          normalizedOutputJson: (normalized.ok
            ? normalized.data
            : { fallback: normalized.data }) as Prisma.InputJsonValue,
          normalizeError: normalized.normalizeError,
        },
      });
      void traceWorkflowEvent({
        event: "phase13.skillExecution",
        phase: parsed.phase ?? 13,
        commandRunId: commandRun.id,
        skillRunId: skillRun.id,
        skillKey,
        executionMode: executed.executionMode,
        fallbackReason: normalized.ok ? null : (normalized.normalizeError ?? "normalize_fallback"),
        metadata: {
          normalizedOk: normalized.ok,
          durationMs,
          executionProfile: profile.name,
        },
      });
      return { skillKey, executed, normalized, skillRun };
    },
  );

  for (const entry of executedRuns) {
    skillRuns.push(entry.skillRun);
    if (entry.executed.executionMode === "llm") llmCallCount += 1;
    else templateCallCount += 1;

    const fromSkill = workBreakdownFromSkillOutput(
      entry.skillKey,
      entry.normalized.ok ? entry.normalized.data : (entry.normalized.data ?? {}),
      effectiveInputSummary,
    );
    if (
      fromSkill.length > 0 &&
      (breakdownDrafts.length === 0 || entry.skillKey === "aios-work-breakdown")
    ) {
      breakdownDrafts = fromSkill;
    }
  }

  if (breakdownDrafts.length === 0) {
    breakdownDrafts = workBreakdownFromNormalizedData(
      { items: [] },
      effectiveInputSummary,
    );
  }

  const breakdownSkillRun = skillRuns.find((run) => run.skillKey === "aios-work-breakdown")
    ?? skillRuns[skillRuns.length - 1];

  const workBreakdownItems: EnrichedWorkBreakdownItem[] = [];
  const handoffItems: Array<{
    title: string;
    targetArea: string;
    agentType: string;
    assignment?: AssignmentSuggestion;
  }> = [];

  for (const [index, item] of breakdownDrafts.entries()) {
    const assignment = recommendAssignmentForWorkItem({
      title: item.title,
      description: item.description,
      targetArea: item.targetArea,
    });

    const row = await prisma.workBreakdownItem.create({
      data: {
        commandRunId: commandRun.id,
        skillRunId: breakdownSkillRun?.id,
        title: item.title,
        description: item.description,
        targetArea: item.targetArea,
        agentType: item.agentType,
        riskLevel: item.riskLevel,
        estimatedHours: item.estimatedHours,
        acceptanceCriteria: item.acceptanceCriteria ?? [],
        testCriteria: item.testCriteria ?? [],
        sortOrder: index + 1,
      },
    });

    workBreakdownItems.push({
      ...row,
      suggestedOwner: assignment.suggestedOwner,
      suggestedAgent: assignment.suggestedAgent,
      confidence: assignment.confidence,
      reason: assignment.reason,
    });

    handoffItems.push({
      title: item.title,
      targetArea: item.targetArea,
      agentType: item.agentType,
      assignment,
    });
  }

  const handoffDraft: HandoffDraft = buildHandoffDraft({
    commandRunId: commandRun.id,
    inputSummary: effectiveInputSummary,
    sourceEntityType: commandRun.sourceEntityType,
    sourceEntityId: commandRun.sourceEntityId,
    workItems: handoffItems,
    skillKeys,
    contextPackSummary,
  });

  const riskLevel = effectiveInputSummary.length > 120 ? "medium" : "low";
  await createApprovalIfNeeded(commandRun.id, riskLevel);

  return {
    commandRunId: commandRun.id,
    sourceEntityType: commandRun.sourceEntityType,
    sourceEntityId: commandRun.sourceEntityId,
    skillKeys,
    skillRuns,
    workBreakdownItems,
    handoffDraft,
    contextPack,
    templateOutput,
    performance: {
      totalDurationMs: Date.now() - runStartedAt,
      llmCallCount,
      templateCallCount,
      executionProfile: profile.name,
      skillConcurrency: profile.skillConcurrency,
    },
  };
}

export async function getPhase13RunDetail(commandRunId: string) {
  const commandRun = await prisma.commandRun.findUnique({
    where: { id: commandRunId },
    include: {
      skillRuns: { orderBy: { sortOrder: "asc" } },
      workBreakdownItems: { orderBy: { sortOrder: "asc" } },
      risk: true,
    },
  });

  return commandRun;
}

export async function runSingleSkill(input: {
  skillKey: string;
  inputSummary: string;
  commandRunId?: string;
}) {
  const executed = await runSkillWithMetadata({
    skillKey: input.skillKey,
    inputSummary: input.inputSummary,
  });
  const normalized = normalizeSkillOutput(executed.rawOutput);

  const skillRun = await prisma.skillRun.create({
    data: {
      commandRunId: input.commandRunId,
      skillKey: input.skillKey,
      status: "completed",
      executionMode: executed.executionMode,
      rawOutputJson: executed.rawOutput as Prisma.InputJsonValue,
      normalizedOutputJson: (normalized.ok ? normalized.data : normalized.data) as Prisma.InputJsonValue,
      normalizeError: normalized.normalizeError,
    },
  });

  return { skillRun, normalized, executed };
}
