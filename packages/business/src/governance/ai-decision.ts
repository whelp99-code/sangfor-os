import { prisma, type Prisma } from "@sangfor/db";

import {
  gateDecision,
  ACTION_TIER_REGISTRY,
  POLICY_VERSION,
  type DecisionActorKey,
} from "./ai-decision-policy";

/**
 * recordDecision — central AI/worker decision instrumentation.
 *
 * Appends a unified row to DomainDecisionLog so every AI/worker decision can
 * later feed confidence calibration + autonomy promotion/demotion (S1 토대).
 *
 * Contract (audit.ts:8 판박이):
 *  - MUST be called OUTSIDE any transaction (best-effort).
 *  - MUST NEVER throw: all failures are swallowed and logged. 계측 실패가
 *    결정 흐름을 막으면 비파괴 위반이므로, 호출부는 결과를 신경 쓰지 않는다.
 *  - actionType이 레지스트리 미등록이면 console.warn + riskTier=T2 로 기록
 *    (fail-closed). riskTier/policyVersion은 결정 시점 스냅샷으로 저장한다.
 */

export type DecisionOutcome = "approved" | "rejected" | "corrected";

export interface RecordAiDecisionInput {
  /** DomainDecisionLog.projectId (NOT NULL in schema). */
  projectId: string;
  /** GtmDomain string (e.g. 'sales'). */
  domain: string;
  actor: DecisionActorKey;
  /** Registry-controlled action key. Unregistered → warn + T2. */
  actionType: string;
  /** Polymorphic ref to the decided artifact (e.g. 'opp:<id>'). */
  caseRef?: string | null;
  outcome?: DecisionOutcome | null;
  /** Predicted confidence when available (nullable by design). */
  predictedConfidence?: number | null;
  modelVersion?: string | null;
  input?: unknown;
  output?: unknown;
  humanEdit?: unknown;
  /** Legacy decision_type column (NOT NULL). Defaults to actionType. */
  decisionType?: string;
}

interface RecordDecisionDeps {
  /** Injectable prisma client for testing. Defaults to the shared singleton. */
  prisma?: typeof prisma;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

export async function recordDecision(
  input: RecordAiDecisionInput,
  deps: RecordDecisionDeps = {},
): Promise<void> {
  const client = deps.prisma ?? prisma;
  try {
    const isRegistered = input.actionType in ACTION_TIER_REGISTRY;
    if (!isRegistered) {
      // fail-closed: 미등록 액션은 T2로 강등되며 여기서 경고.
      console.warn(
        `[recordDecision] unregistered actionType='${input.actionType}' → riskTier=T2 (fail-closed)`,
      );
    }

    const gate = gateDecision(
      input.actor,
      input.actionType,
      input.predictedConfidence ?? undefined,
    );

    await client.domainDecisionLog.create({
      data: {
        projectId: input.projectId,
        domain: input.domain,
        caseRef: input.caseRef ?? undefined,
        decisionType: input.decisionType ?? input.actionType,
        outcome: input.outcome ?? undefined,
        actor: input.actor,
        actionType: input.actionType,
        riskTier: gate.tier,
        policyVersion: POLICY_VERSION,
        predictedConfidence: input.predictedConfidence ?? undefined,
        modelVersion: input.modelVersion ?? undefined,
        inputJson: toJsonInput(input.input),
        outputJson: toJsonInput(input.output),
        humanEditJson: toJsonInput(input.humanEdit),
      },
    });
  } catch (error) {
    // Best-effort: swallow. NEVER propagate to the decision flow.
    console.error("[recordDecision] failed (swallowed):", error);
  }
}
