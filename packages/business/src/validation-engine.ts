import { prisma } from "@ai-portal/db";

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

  await prisma.llmCall.create({
    data: {
      commandRunId,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      inputTokens: 1200,
      outputTokens: 400,
      latencyMs: 850,
    },
  });

  await prisma.costEvent.create({
    data: {
      commandRunId,
      source: "llm",
      amountUsd: 0.02,
      metadata: { mock: true },
    },
  });

  return plan;
}

export async function getObservabilitySummary() {
  const [llmCalls, costEvents, failures] = await Promise.all([
    prisma.llmCall.count(),
    prisma.costEvent.aggregate({ _sum: { amountUsd: true } }),
    prisma.workflowStep.count({ where: { status: "failed" } }),
  ]);

  return {
    llmCalls,
    totalCostUsd: costEvents._sum.amountUsd ?? 0,
    workflowFailures: failures,
  };
}
