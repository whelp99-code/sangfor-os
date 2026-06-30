import type { ProposalTemplateKey } from "@sangfor/shared";

/**
 * 제안서 템플릿 key → 한글 표시 라벨 매핑.
 * value(key)는 그대로 유지하고, 사용자에게 보이는 라벨만 한글로 표기한다.
 */
export const PROPOSAL_TEMPLATE_LABELS: Record<ProposalTemplateKey, string> = {
  "standard-proposal": "표준 제안서",
  "poc-summary": "PoC 요약",
  "technical-spec": "기술 사양서",
  "pricing-sheet": "가격 산정서",
  "executive-brief": "경영 요약",
  "implementation-plan": "구축 계획서",
  "support-handoff": "지원 인수인계",
};

/** 매핑에 없는 key는 raw key로 안전하게 폴백한다. */
export function proposalTemplateLabel(key: string): string {
  return PROPOSAL_TEMPLATE_LABELS[key as ProposalTemplateKey] ?? key;
}
