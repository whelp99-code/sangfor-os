/**
 * AI Decision Policy — risk-tier registry + fail-closed gate (pure).
 *
 * S1 1차 슬라이스: 라벨링 전용. gateDecision은 흐름을 분기하지 않고,
 * recordDecision()이 riskTier/policyVersion을 스냅샷 저장할 때만 쓴다.
 *
 * 안전 화이트리스트(fail-closed): 레지스트리에 등록된 액션만 T0/T1을
 * 부여받고, 미등록 액션은 무조건 T2(항상 사람)로 취급한다. 현행
 * isUnsafeAction의 "위험 allowlist"(미등록=자동) 의미를 반전한 것.
 */

export type DecisionActorKey =
  | "sales"
  | "presales"
  | "cfo"
  | "marketing"
  | "engineer"
  | "commercial_approval"
  | "deal_registration";

export type RiskTierValue = "T0" | "T1" | "T2";

/**
 * Static risk-tier whitelist. Only actions listed here get T0/T1.
 * Anything not listed is treated as T2 by gateDecision (fail-closed).
 *
 * 1차는 최소 등록만: 나머지는 미등록=T2로 남겨 후속 슬라이스에서 확장.
 */
export const ACTION_TIER_REGISTRY: Record<string, "T0" | "T1"> = {
  // 내부·되돌림가능·무발신 → T0
  stage_transition: "T0",
  // 외부·저위험·승인후 발신 → T1
  mail_revalidation: "T1",
};

/**
 * S1 커버리지 확대: 계약/재무/등록 관련 결정은 fail-closed 원칙(스펙 §5)에 따라
 * 낮은 티어를 부여하지 않는다. 아래 액션들은 의도적으로 레지스트리에 등록하지
 * 않으므로 gateDecision이 미등록=T2(항상 사람)로 스냅샷한다.
 *
 *  - deal_registration               (딜 등록 승인/거절 — 등록/채널보호 관련)
 *  - commercial_approval_resolution  (상업승인 사람 resolution — 재무/계약 관련)
 *
 * 이 상수는 "왜 등록하지 않았는가"를 문서화하고 회귀 테스트가 T2 스냅샷을
 * 검증하는 근거가 된다. 런타임 로직에는 관여하지 않는다.
 */
export const FAIL_CLOSED_T2_ACTIONS = [
  "deal_registration",
  "commercial_approval_resolution",
] as const;

/**
 * riskTier 근거 정책 버전. 정책이 바뀌면 이 상수를 올리고,
 * 과거 로그는 자신이 기록된 시점의 policyVersion 스냅샷을 유지한다.
 */
export const POLICY_VERSION = "s1-2026-07-01";

export interface DecisionGateResult {
  tier: RiskTierValue;
  /** true면 이 결정은 사람 개입이 필요하다. */
  requiresHuman: boolean;
  /** true면 사람 없이 자동 실행이 허용된다(T0만). */
  autoAllowed: boolean;
}

/**
 * Pure fail-closed gate. 미등록 actionType(또는 빈 값) → T2.
 *
 * 1차 슬라이스는 라벨링 전용이므로 confidence는 tier를 바꾸지 않는다
 * (파라미터로 받되 라벨에 영향 없음 — 시그니처 안정성/후속 확장 대비).
 *
 * @param _actor      결정 주체(도메인 레인/횡단 게이트). 1차엔 라벨 미사용.
 * @param actionType  레지스트리 키.
 * @param _confidence 예측 신뢰도(있을 때). 1차엔 tier 산정에 미사용.
 */
export function gateDecision(
  _actor: DecisionActorKey,
  actionType: string,
  _confidence?: number,
): DecisionGateResult {
  const tier: RiskTierValue = ACTION_TIER_REGISTRY[actionType] ?? "T2";

  // T0만 자동 허용. T1/T2는 사람 필요(1차 정책: T1=승인후 발신).
  const autoAllowed = tier === "T0";
  const requiresHuman = tier !== "T0";

  return { tier, requiresHuman, autoAllowed };
}
