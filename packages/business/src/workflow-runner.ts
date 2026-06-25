import { prisma } from "@sangfor/db";

import { logStateTransition, processPendingOutboxEvents } from "./audit";
import { ensureApprovalForRun } from "./approval-gate";

/**
 * Purpose: Phase 5 mock workflow runner — advance steps, agent messages, tool dry-runs.
 * Failure Points: Step order gaps; tool call failures without retry metadata.
 * Observability: automation.workflow_steps, audit.state_transition_logs, audit.outbox_events
 */
export async function runWorkflowMock(commandRunId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: { commandRunId },
    include: {
      steps: {
        orderBy: { sortOrder: "asc" },
        include: { agentAssignments: true },
      },
    },
  });

  if (!workflow) throw new Error("workflow_not_found");

  await ensureApprovalForRun(commandRunId);

  for (const step of workflow.steps) {
    const from = step.status;
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: "running" },
    });
    await logStateTransition({
      entityType: "workflow_step",
      entityId: step.id,
      fromStatus: from,
      toStatus: "running",
      actorType: "engine",
    });

    if (step.stepKey === "assign-agent" && step.agentAssignments[0]) {
      const assignment = step.agentAssignments[0];
      await prisma.agentMessage.create({
        data: {
          agentAssignmentId: assignment.id,
          role: "assistant",
          content: "Mock agent assigned. Planning tool calls.",
        },
      });
      await prisma.agentDecisionLog.create({
        data: {
          agentAssignmentId: assignment.id,
          decision: "proceed_with_mock_tools",
          metadata: { confidence: 0.9 },
        },
      });
    }

    if (step.stepKey === "execute-tools" && workflow.steps.some((s) => s.stepKey === "assign-agent")) {
      const assignStep = workflow.steps.find((s) => s.stepKey === "assign-agent");
      const assignment = assignStep?.agentAssignments[0];
      if (assignment) {
        await prisma.toolCall.create({
          data: {
            agentAssignmentId: assignment.id,
            toolKey: "dry_run_shell",
            status: "succeeded",
          },
        });
      }
    }

    if (step.stepKey === "validate") {
      await prisma.validationResult.create({
        data: {
          workflowStepId: step.id,
          checkKey: "mock-quality-gate",
          status: "passed",
          detailsJson: { lint: true, test: true },
        },
      });
    }

    if (step.stepKey === "report") {
      const validateStep = workflow.steps.find((s) => s.stepKey === "validate");
      const validation = validateStep
        ? await prisma.validationResult.findFirst({
            where: { workflowStepId: validateStep.id },
          })
        : null;
      if (validation) {
        await prisma.report.create({
          data: {
            validationResultId: validation.id,
            title: "Mock execution report",
            bodyMarkdown: "Workflow mock completed successfully.",
          },
        });
      }
    }

    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: "completed" },
    });
    await logStateTransition({
      entityType: "workflow_step",
      entityId: step.id,
      fromStatus: "running",
      toStatus: "completed",
      actorType: "engine",
    });
  }

  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { status: "completed" },
  });

  await prisma.commandRun.update({
    where: { id: commandRunId },
    data: { status: "completed" },
  });

  await processPendingOutboxEvents();
  return getWorkflowSummary(commandRunId);
}

async function getWorkflowSummary(commandRunId: string) {
  return prisma.commandRun.findUnique({
    where: { id: commandRunId },
    include: {
      workflows: { include: { steps: { include: { agentAssignments: { include: { toolCalls: true, messages: true } } } } } },
    },
  });
}

export async function retryFailedStep(stepId: string) {
  const step = await prisma.workflowStep.findUniqueOrThrow({ where: { id: stepId } });
  await prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: "pending" },
  });
  await logStateTransition({
    entityType: "workflow_step",
    entityId: stepId,
    fromStatus: step.status,
    toStatus: "pending",
    actorType: "engine",
    metadata: { retry: true },
  });
  return step;
}
