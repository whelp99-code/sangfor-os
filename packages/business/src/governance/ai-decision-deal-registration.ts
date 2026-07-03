import { prisma } from "@sangfor/db";

import { recordDecision } from "./ai-decision";

/**
 * Deal-registration decision instrumentation (S1 커버리지 확대 슬라이스).
 *
 * 딜 등록의 승인/거절은 채널보호·등록 관련 사람 결정이지만 지금까지 통일
 * 로그(DomainDecisionLog)에 아무것도 남기지 않았다. 이 헬퍼는 등록 상태가
 * APPROVED/REJECTED로 영속되는 지점(upsertDealRegistration)에서 호출되어
 * recordDecision을 커밋한다.
 *
 * 계약(비파괴):
 *  - MUST be called OUTSIDE any transaction (best-effort).
 *  - MUST NEVER throw. recordDecision 자체가 삼키지만, 매핑 단계의 예외까지
 *    확실히 삼켜 결정 흐름을 절대 막지 않는다.
 *  - APPROVED/REJECTED만 결정으로 기록한다. 그 외 상태 전이(제출/만료 등)는
 *    사람의 승인/거절 결정이 아니므로 기록하지 않는다.
 *  - actionType='deal_registration'은 티어 레지스트리 미등록(fail-closed, 스펙
 *    §5: 등록/계약 관련) → recordDecision이 riskTier=T2 스냅샷을 남긴다.
 */

export interface RecordDealRegistrationInput {
  /** DomainDecisionLog.projectId (NOT NULL). 기회의 프로젝트 스코프. */
  projectId: string;
  /** 딜 등록 대상 기회 id. caseRef='opp:<id>'로 저장. */
  opportunityId: string;
  /** upsert가 적용한 등록 상태. APPROVED/REJECTED일 때만 결정으로 기록. */
  regStatus?:
    | "NOT_SUBMITTED"
    | "SUBMITTED"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED"
    | "CONTESTED"
    | null;
  /** 감사용: 등록번호(있을 때). */
  registrationNumber?: string | null;
}

interface RecordDealRegistrationDeps {
  prisma?: typeof prisma;
}

export async function recordDealRegistrationDecision(
  input: RecordDealRegistrationInput,
  deps: RecordDealRegistrationDeps = {},
): Promise<void> {
  try {
    // 사람의 승인/거절 resolution만 결정으로 기록한다.
    let outcome: "approved" | "rejected";
    if (input.regStatus === "APPROVED") outcome = "approved";
    else if (input.regStatus === "REJECTED") outcome = "rejected";
    else return;

    await recordDecision(
      {
        projectId: input.projectId,
        domain: "sales",
        actor: "deal_registration",
        actionType: "deal_registration",
        caseRef: "opp:" + input.opportunityId,
        outcome,
        predictedConfidence: null,
        input: {
          opportunityId: input.opportunityId,
          regStatus: input.regStatus,
          registrationNumber: input.registrationNumber ?? null,
        },
      },
      deps.prisma ? { prisma: deps.prisma } : {},
    );
  } catch (error) {
    // recordDecision already swallows, but keep the mapping path fail-safe too.
    console.error("[recordDealRegistrationDecision] failed (swallowed):", error);
  }
}
