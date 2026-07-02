import { Prisma, prisma } from "@sangfor/db";

/**
 * @deprecated Writes the legacy `policy_decision_logs` audit stream, NOT the
 * canonical decision spine (`domain_decision_logs` via `recordDecision()`).
 * New governed decisions must flow through `recordDecision()`; this writer is
 * kept for mail-pipeline audit continuity only (deprecate-not-drop — ADR-001).
 */
export async function recordPolicyDecision(
  projectId: string,
  input: {
    entityType: string;
    entityId?: string | null;
    decisionType: string;
    inputJson?: Prisma.InputJsonValue;
    outputJson?: Prisma.InputJsonValue;
  },
) {
  await prisma.policyDecisionLog.create({
    data: {
      projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      decisionType: input.decisionType,
      inputJson: input.inputJson,
      outputJson: input.outputJson,
    },
  });
}
