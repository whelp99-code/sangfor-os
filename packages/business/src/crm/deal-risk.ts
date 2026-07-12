import { formatKRW, formatKRWCompact } from "@sangfor/shared";

import { normalizeOpportunityStage } from "./opportunity-stage";

export interface DealRiskInput {
  stageDwellDays: number;
  amount?: number | null;
  probability?: number;
  mailSilenceDays?: number | null;
  lensFailCount?: number;
  stage?: string;
  overdueDays?: number | null;
  hasNextAction?: boolean;
}

export interface DealRiskFactor {
  key: string;
  label: string;
  contribution: number;
  note: string;
}

export interface DealRiskResult {
  score: number;
  level: "low" | "medium" | "high";
  factors: DealRiskFactor[];
}

function levelFromScore(score: number): DealRiskResult["level"] {
  if (score > 66) return "high";
  if (score >= 34) return "medium";
  return "low";
}

function stageDwellFactor(days: number): DealRiskFactor {
  if (days > 30) {
    return { key: "stage_dwell", label: "스테이지 체류", contribution: 40, note: `현재 스테이지 체류 ${days}일 (30일 초과)` };
  }
  if (days >= 15) {
    return { key: "stage_dwell", label: "스테이지 체류", contribution: 20, note: `현재 스테이지 체류 ${days}일 (15~30일)` };
  }
  return { key: "stage_dwell", label: "스테이지 체류", contribution: 0, note: `현재 스테이지 체류 ${days}일 (정상 범위)` };
}

function mailSilenceFactor(days: number | null | undefined): DealRiskFactor {
  if (days == null) {
    return { key: "mail_silence", label: "메일 공백", contribution: 0, note: "데이터 없음(메일 연동 미확인)" };
  }
  if (days > 14) {
    return { key: "mail_silence", label: "메일 공백", contribution: 30, note: `마지막 메일 이후 ${days}일 경과 (14일 초과)` };
  }
  if (days >= 8) {
    return { key: "mail_silence", label: "메일 공백", contribution: 15, note: `마지막 메일 이후 ${days}일 경과 (8~14일)` };
  }
  return { key: "mail_silence", label: "메일 공백", contribution: 0, note: `마지막 메일 이후 ${days}일 경과 (정상 범위)` };
}

function lensFailFactor(count: number): DealRiskFactor {
  if (count <= 0) {
    return { key: "lens_fail", label: "컬러게이트 fail 이력", contribution: 0, note: "게이트 fail 이력 없음" };
  }
  const contribution = Math.min(count * 10, 20);
  return { key: "lens_fail", label: "컬러게이트 fail 이력", contribution, note: `게이트 fail ${count}건` };
}

function probabilityFactor(probability: number | undefined): DealRiskFactor {
  if (probability === undefined) {
    return { key: "probability", label: "승률", contribution: 0, note: "승률 데이터 없음" };
  }
  if (probability < 30) {
    return { key: "probability", label: "승률", contribution: 15, note: `승률 매우 낮음(${probability}%)` };
  }
  if (probability < 60) {
    return { key: "probability", label: "승률", contribution: 10, note: `승률 저조(${probability}%)` };
  }
  return { key: "probability", label: "승률", contribution: 0, note: `승률 양호(${probability}%)` };
}

function overdueFactor(overdueDays: number | null | undefined): DealRiskFactor {
  if (overdueDays == null || overdueDays <= 0) {
    return { key: "overdue", label: "마감 경과", contribution: 0, note: "마감일 미지정 또는 미도래" };
  }
  if (overdueDays > 30) {
    return { key: "overdue", label: "마감 경과", contribution: 30, note: `마감일 ${overdueDays}일 초과(30일 이상)` };
  }
  return { key: "overdue", label: "마감 경과", contribution: 20, note: `마감일 ${overdueDays}일 경과` };
}

function nextActionFactor(hasNextAction: boolean | undefined): DealRiskFactor {
  if (hasNextAction === false) {
    return { key: "next_action", label: "다음 액션", contribution: 10, note: "다음 액션 미지정 — 방치 위험" };
  }
  return { key: "next_action", label: "다음 액션", contribution: 0, note: hasNextAction ? "다음 액션 설정됨" : "데이터 없음" };
}

function amountFactor(amount: number | null | undefined): DealRiskFactor | null {
  if (amount == null) return null;
  return {
    key: "amount",
    label: "딜 규모(영향도)",
    contribution: 0,
    note: `고액 딜일수록 영향(stake)이 큼 — ${formatKRW(amount)} (${formatKRWCompact(amount)})`,
  };
}

export function computeDealRisk(input: DealRiskInput): DealRiskResult {
  if (input.stage != null) {
    const normalized = normalizeOpportunityStage(input.stage);
    if (normalized === "WON" || normalized === "LOST") {
      return {
        score: 0,
        level: "low",
        factors: [
          {
            key: "terminal",
            label: "종료 딜",
            contribution: 0,
            note: "딜 종료(수주/실주) — 리스크 예측 대상 아님",
          },
        ],
      };
    }
  }

  const factors: DealRiskFactor[] = [
    stageDwellFactor(input.stageDwellDays),
    overdueFactor(input.overdueDays),
    nextActionFactor(input.hasNextAction),
    mailSilenceFactor(input.mailSilenceDays),
    lensFailFactor(input.lensFailCount ?? 0),
    probabilityFactor(input.probability),
  ];
  const amount = amountFactor(input.amount);
  if (amount) factors.push(amount);

  const rawScore = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  return { score, level: levelFromScore(score), factors };
}
