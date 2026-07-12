import { prisma } from "@sangfor/db";
import { summarizeLlmCalls } from "../platform/llm-metering";

/**
 * Purpose: Phase 8 validation & observability recording.
 */
export async function runValidationPlan(commandRunId: string, checks: { key: string; passed: boolean }[]) {
  const plan = await prisma.validationPlan.create({
    data: {
      commandRunId,
      name: "lint-test-build",
      status: checks.every((c) => c.passed) ? "passed" : "failed",
    },
  });

  for (const check of checks) {
    await prisma.validationCheck.create({
      data: {
        planId: plan.id,
        checkKey: check.key,
        status: check.passed ? "passed" : "failed",
      },
    });

    const step = await prisma.workflowStep.findFirst({
      where: { workflow: { commandRunId }, stepKey: "validate" },
    });
    if (step) {
      await prisma.validationResult.create({
        data: {
          workflowStepId: step.id,
          checkKey: check.key,
          status: check.passed ? "passed" : "failed",
          detailsJson: { automated: true },
        },
      });
    }
  }

  await prisma.qualityGate.upsert({
    where: { gateKey: "default-merge-gate" },
    update: { requiredChecks: ["lint", "test", "build"] },
    create: {
      gateKey: "default-merge-gate",
      requiredChecks: ["lint", "test", "build"],
    },
  });

  return plan;
}

export async function getObservabilitySummary() {
  const [llmCallSummary, costEvents, failures] = await Promise.all([
    summarizeLlmCalls(),
    prisma.costEvent.aggregate({ _sum: { amountUsd: true } }),
    prisma.workflowStep.count({ where: { status: "failed" } }),
  ]);

  return {
    llmCalls: llmCallSummary.total,
    last24h: llmCallSummary.last24h,
    last7d: llmCallSummary.last7d,
    latencyP50: llmCallSummary.latencyP50,
    latencyP95: llmCallSummary.latencyP95,
    failureRate: llmCallSummary.failureRate,
    totalCostUsd: costEvents._sum.amountUsd ?? 0,
    workflowFailures: failures,
  };
}
