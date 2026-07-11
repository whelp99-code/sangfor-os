// 결정형 컬러 게이트 — 메일 파생 후보/영업기회에 5-렌즈 검증을 적용한다.
// LLM 없이(비용 0) 실 신호(신뢰도·재검증 결정·유형·마진)로 각 렌즈를 판정하고,
// domain-agent-runtime 의 colorGateJson 과 동일한 형태 { required, reviewed, failed, pass }
// 를 산출한다. 도메인 에이전트(LLM) 게이트가 나중에 이 자리를 대체할 수 있다.

import { type ColorKey, routeColorAgents, checkColorGate } from "./color-agent";

export type LensState = "pass" | "fail" | "na";

export type CandidateColorGate = {
  required: ColorKey[];
  reviewed: ColorKey[];
  failed: ColorKey[];
  pass: boolean;
  lenses: Record<Exclude<ColorKey, "purple">, LensState>;
  mode: "deterministic";
};

export type CandidateColorInput = {
  candidateType: string; // customer | partner | opportunity | poc | task
  confidence: number; // 0..100
  revalidation?: string | null; // approve_candidate | needs_human_review | reject | knowledge_only | ...
  hasSummary?: boolean;
  amount?: number | null;
  marginPercent?: number | null; // 있으면 Orange 판정에 사용
  isRenewal?: boolean; // 리뉴얼 딜은 마진 필수 검증
};

const COMMERCIAL = new Set(["opportunity", "customer", "partner"]);

/** 후보 1건의 5-렌즈 결정형 게이트. */
export function evaluateCandidateColorGate(
  input: CandidateColorInput
): CandidateColorGate {
  const conf = Math.max(0, Math.min(100, input.confidence ?? 0));
  const riskLevel =
    conf < 50 ? "high" : conf < 70 ? "medium" : ("low" as const);

  const routing = routeColorAgents({
    artifactType: input.candidateType,
    riskLevel,
    isCustomerFacing: true, // 메일 파생 = 외부 접점
    hasRestrictedData: false,
    isCommercial: COMMERCIAL.has(input.candidateType),
    affectsUI: false,
    affectsArchitecture: input.candidateType === "poc",
  });
  const required = routing.required.filter((k) => k !== "purple");

  // 각 렌즈 결정형 판정
  const reval = input.revalidation ?? null;
  const rejectLike = reval === "reject" || reval === "needs_check";
  const lenses: Record<Exclude<ColorKey, "purple">, LensState> = {
    // Blue 기술: 기술 리스크 신호 없음 → 신뢰도 기반
    blue: conf >= 50 ? "pass" : "fail",
    // Red 리스크: 재검증 거부/재확인 필요 → fail
    red: rejectLike ? "fail" : "pass",
    // Orange 가치·마진: 마진 있으면 20% 기준, 없으면 상업성+신뢰도
    // 리뉴얼 딜은 마진Percent 필수 — 20% 미만이면 fail
    orange:
      input.isRenewal && (input.marginPercent == null || input.marginPercent < 20)
        ? "fail"
        : input.marginPercent != null
          ? input.marginPercent >= 20
            ? "pass"
            : "fail"
          : COMMERCIAL.has(input.candidateType)
            ? conf >= 60
              ? "pass"
              : "fail"
            : "pass",
    // Gray 근거: 요약·신뢰도로 근거 충분성
    gray: input.hasSummary && conf >= 60 ? "pass" : conf >= 75 ? "pass" : "fail",
    // Teal UX: 고객 전달 명료성 — 요약 존재
    teal: input.hasSummary ? "pass" : "na",
  };

  const allKeys: Exclude<ColorKey, "purple">[] = ["blue", "red", "orange", "gray", "teal"];
  const reviewed = allKeys.filter((k) => lenses[k] !== "na") as ColorKey[];
  const failed = allKeys.filter((k) => lenses[k] === "fail") as ColorKey[];
  const pass = checkColorGate(required, reviewed, failed);

  return { required, reviewed, failed, pass, lenses, mode: "deterministic" };
}
