import { prisma } from "@sangfor/db";

import { recordDecision } from "./ai-decision";

/**
 * Commercial-approval RESOLUTION instrumentation (S1 커버리지 확대 슬라이스).
 *
 * 상업승인 "제출"은 이미 recordCommercialApprovalDecision(outcome=null)으로
 * 계측됐지만, 사람이 실제로 승인/반려하는 resolution 지점은 통일 로그에
 * 아무것도 남기지 않았다. 이 헬퍼는 상업 ApprovalRequest가 approved/rejected로
 * 영속되는 지점에서 호출되어 outcome이 확정된 결정을 커밋한다.
 *
 * 계약(비파괴):
 *  - MUST be called OUTSIDE any transaction (best-effort).
 *  - MUST NEVER throw. recordDecision 자체가 삼키지만, projectId 조회/매핑
 *    단계의 예외까지 확실히 삼켜 결정 흐름을 절대 막지 않는다.
 *  - ApprovalRequest 스키마엔 projectId가 없으므로, 명시적으로 주어지지 않으면
 *    프로젝트 슬러그('demo-project') 규약으로 best-effort 조회한다. 조회 실패
 *    시엔 기록하지 않고 조용히 반환한다(DomainDecisionLog.projectId는 NOT NULL).
 *  - actionType='commercial_approval_resolution'은 티어 레지스트리 미등록
 *    (fail-closed, 스펙 §5: 재무/계약 관련) → riskTier=T2 스냅샷.
 */

const DEFAULT_PROJECT_SLUG = "demo-project";

export interface RecordCommercialApprovalResolutionInput {
  /** resolution 대상 상업승인 견적 id. caseRef='quote:<id>'로 저장. */
  quoteId: string;
  /** 사람 결정 결과. */
  outcome: "approved" | "rejected";
  /** 알려진 경우의 프로젝트 스코프. 미지정 시 슬러그 규약으로 조회. */
  projectId?: string | null;
  /** 감사용: resolution actor id(있을 때). */
  actorId?: string | null;
}

interface RecordCommercialApprovalResolutionDeps {
  prisma?: typeof prisma;
}

export async function recordCommercialApprovalResolution(
  input: RecordCommercialApprovalResolutionInput,
  deps: RecordCommercialApprovalResolutionDeps = {},
): Promise<void> {
  const client = deps.prisma ?? prisma;
  try {
    let projectId = input.projectId ?? null;
    if (!projectId) {
      const project = await client.project.findUnique({
        where: { slug: DEFAULT_PROJECT_SLUG },
        select: { id: true },
      });
      projectId = project?.id ?? null;
    }
    // NOT NULL 제약: projectId 없으면 조용히 스킵(비파괴).
    if (!projectId) return;

    await recordDecision(
      {
        projectId,
        domain: "sales",
        actor: "commercial_approval",
        actionType: "commercial_approval_resolution",
        caseRef: "quote:" + input.quoteId,
        outcome: input.outcome,
        predictedConfidence: null,
        input: {
          quoteId: input.quoteId,
          actorId: input.actorId ?? null,
        },
      },
      deps.prisma ? { prisma: deps.prisma } : {},
    );
  } catch (error) {
    // recordDecision already swallows, but keep the mapping path fail-safe too.
    console.error("[recordCommercialApprovalResolution] failed (swallowed):", error);
  }
}
