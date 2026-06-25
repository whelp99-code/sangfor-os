import { prisma } from "@ai-portal/db";
import { z } from "zod";

import { enqueueOutboxEvent, logStateTransition } from "./audit";
import { createApprovalIfNeeded } from "./approval-gate";

export const phase13SourceEntityTypeSchema = z.enum([
  "opportunity",
  "proposal",
  "poc",
]);

export const createCommandRunSchema = z.object({
  inputSummary: z.string().min(3),
  projectSlug: z.string().default("demo-project"),
  commandKey: z.string().default("user-request"),
  sourceEntityType: phase13SourceEntityTypeSchema.optional(),
  sourceEntityId: z.string().min(1).optional(),
}).refine(
  (data) =>
    (data.sourceEntityType == null && data.sourceEntityId == null) ||
    (data.sourceEntityType != null && data.sourceEntityId != null),
  { message: "sourceEntityType and sourceEntityId must be provided together" },
);

const DEFAULT_STEPS = [
  "analyze-intent",
  "assess-risk",
  "plan-workflow",
  "assign-agent",
  "execute-tools",
  "validate",
  "report",
] as const;

/**
 * Purpose: Phase 4 Command Center — create command_run with mock intent/risk/workflow.
 * Failure Points: Missing project/command seed rows; FK violations on module keys.
 * Observability: automation.command_runs, audit.state_transition_logs
 */
export async function createCommandRun(input: z.infer<typeof createCommandRunSchema>) {
  const parsed = createCommandRunSchema.parse(input);

  const project = await prisma.project.findUniqueOrThrow({
    where: { slug: parsed.projectSlug },
  });

  const command = await prisma.command.upsert({
    where: { key: parsed.commandKey },
    update: {},
    create: {
      key: parsed.commandKey,
      title: "User feature request",
      description: "Created from Command Center",
    },
  });

  const user = await prisma.user.findFirst();

  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.commandRun.create({
      data: {
        commandId: command.id,
        projectId: project.id,
        requestedById: user?.id,
        status: "running",
        inputSummary: parsed.inputSummary,
        sourceEntityType: parsed.sourceEntityType,
        sourceEntityId: parsed.sourceEntityId,
      },
    });

    await tx.intentAnalysis.create({
      data: {
        commandRunId: run.id,
        summary: `Intent: ${parsed.inputSummary.slice(0, 120)}`,
        intentJson: { category: "feature", confidence: 0.82 },
      },
    });

    await tx.riskAnalysis.create({
      data: {
        commandRunId: run.id,
        riskLevel: parsed.inputSummary.length > 80 ? "medium" : "low",
        riskJson: { requiresApproval: parsed.inputSummary.length > 80 },
      },
    });

    const riskLevel = parsed.inputSummary.length > 80 ? "medium" : "low";

    const workflow = await tx.workflow.create({
      data: { commandRunId: run.id, status: "running" },
    });

    for (const [index, stepKey] of DEFAULT_STEPS.entries()) {
      const step = await tx.workflowStep.create({
        data: {
          workflowId: workflow.id,
          stepKey,
          status: index === 0 ? "running" : "pending",
          sortOrder: index + 1,
        },
      });

      if (stepKey === "assign-agent") {
        await tx.agentAssignment.create({
          data: {
            workflowStepId: step.id,
            agentKey: "cursor-main",
            status: "assigned",
          },
        });
      }
    }

    await logStateTransition({
      entityType: "command_run",
      entityId: run.id,
      fromStatus: "pending",
      toStatus: "running",
      actorType: "user",
      actorId: user?.id,
    });

    await enqueueOutboxEvent({
      eventType: "command_run.created",
      aggregateType: "command_run",
      aggregateId: run.id,
      payload: { inputSummary: parsed.inputSummary },
    });

    return { run, riskLevel };
  });

  await createApprovalIfNeeded(result.run.id, result.riskLevel);
  return result.run;
}

export async function listCommandRuns(limit = 20) {
  return prisma.commandRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      command: true,
      project: true,
      intent: true,
      risk: true,
    },
  });
}

export async function getCommandRunDetail(id: string) {
  return prisma.commandRun.findUnique({
    where: { id },
    include: {
      command: true,
      project: true,
      intent: true,
      risk: true,
      workflows: {
        include: {
          steps: {
            orderBy: { sortOrder: "asc" },
            include: {
              agentAssignments: {
                include: {
                  toolCalls: true,
                  messages: true,
                  decisions: true,
                },
              },
              validationResults: { include: { reports: true } },
            },
          },
        },
      },
      codeChanges: { include: { changedFiles: true, buildRuns: { include: { testRuns: true } } } },
    },
  });
}

export function buildTimeline(run: NonNullable<Awaited<ReturnType<typeof getCommandRunDetail>>>) {
  const items: { label: string; status: string; at: string }[] = [
    { label: "Command run created", status: run.status, at: run.createdAt.toISOString() },
  ];

  if (run.intent) {
    items.push({ label: "Intent analysis", status: "completed", at: run.intent.createdAt.toISOString() });
  }
  if (run.risk) {
    items.push({ label: `Risk: ${run.risk.riskLevel}`, status: "completed", at: run.risk.createdAt.toISOString() });
  }

  for (const workflow of run.workflows) {
    for (const step of workflow.steps) {
      items.push({
        label: step.stepKey,
        status: step.status,
        at: step.updatedAt.toISOString(),
      });
    }
  }

  return items;
}
