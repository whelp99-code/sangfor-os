import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PrismaClient } from "@prisma/client";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";
const prisma = new PrismaClient();

describe.skipIf(!integrationEnabled)("DB kernel seed chain", () => {
  it("loads command_run → workflow → step → agent → tool → validation → report", async () => {
    const run = await prisma.commandRun.findFirst({
      where: { inputSummary: { contains: "Validate DB kernel" } },
      include: {
        workflows: {
          include: {
            steps: {
              include: {
                agentAssignments: { include: { toolCalls: true } },
                validationResults: { include: { reports: true } },
              },
            },
          },
        },
      },
    });

    expect(run).not.toBeNull();
    expect(run!.workflows.length).toBeGreaterThan(0);

    const step = run!.workflows[0]?.steps[0];
    expect(step?.agentAssignments[0]?.toolCalls.length).toBeGreaterThan(0);
    expect(step?.validationResults[0]?.reports.length).toBeGreaterThan(0);

    const transitions = await prisma.stateTransitionLog.findFirst({
      where: { entityType: "command_run", entityId: run!.id },
    });
    expect(transitions?.toStatus).toBe("running");

    const outbox = await prisma.outboxEvent.findFirst({
      where: { aggregateId: run!.id, eventType: "command_run.started" },
    });
    expect(["pending", "processed"]).toContain(outbox?.status);
  });
});
