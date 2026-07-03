import { prisma } from "@sangfor/db";

import { recordDecision } from "./ai-decision";

/**
 * Commercial-approval decision instrumentation (S1 슬라이스 2 — 커버리지 갭).
 *
 * 상업승인 결정은 지금까지 통일 로그(DomainDecisionLog)에 아무것도 남기지
 * 않았다. 이 헬퍼는 상업승인이 실제로 제기/영속된 async 지점에서 호출되어
 * recordDecision을 커밋한다.
 *
 * 계약(비파괴):
 *  - MUST be called OUTSIDE any transaction (best-effort).
 *  - MUST NEVER throw. recordDecision 자체가 삼키지만, 매핑 단계의 예외까지
 *    확실히 삼켜 결정 흐름을 절대 막지 않는다.
 *  - outcome은 이 시점에 아직 확정되지 않음(승인/반려는 사람 resolution 이후) →
 *    null로 둔다(잠정). predictedConfidence도 이 지점엔 없음 → null.
 *  - actionType='commercial_approval'은 티어 레지스트리 미등록 →
 *    recordDecision이 fail-closed로 riskTier=T2 스냅샷을 남긴다.
 */

export interface RecordCommercialApprovalInput {
  /** DomainDecisionLog.projectId (NOT NULL). 뮤테이션의 회사/프로젝트 스코프. */
  projectId: string;
  /** 상업승인 대상 견적 id. caseRef='quote:<id>'로 저장. */
  quoteId: string;
  /** 연결 기회 id(감사용). */
  opportunityId?: string | null;
  /** 승인 요청 사유(마진/할인 등). */
  reason?: string | null;
}

interface RecordCommercialApprovalDeps {
  prisma?: typeof prisma;
}

export async function recordCommercialApprovalDecision(
  input: RecordCommercialApprovalInput,
  deps: RecordCommercialApprovalDeps = {},
): Promise<void> {
  try {
    await recordDecision(
      {
        projectId: input.projectId,
        domain: "sales",
        actor: "commercial_approval",
        actionType: "commercial_approval",
        caseRef: "quote:" + input.quoteId,
        // 잠정: 사람 resolution 전이라 승인결과 미확정.
        outcome: null,
        predictedConfidence: null,
        input: {
          quoteId: input.quoteId,
          opportunityId: input.opportunityId ?? null,
          reason: input.reason ?? null,
        },
      },
      deps.prisma ? { prisma: deps.prisma } : {},
    );
  } catch (error) {
    // recordDecision already swallows, but keep the mapping path fail-safe too.
    console.error("[recordCommercialApprovalDecision] failed (swallowed):", error);
  }
}
