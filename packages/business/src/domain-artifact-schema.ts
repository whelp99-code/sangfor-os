import type { GtmDomain } from "@sangfor/shared/modes";

/**
 * 도메인별 구조화 산출물 JSON 스키마.
 * opencode `format: { type:"json_schema", schema }` 로 전달 → 모델이 검증된 JSON 을 반환한다.
 * 줄글 대신 타입 데이터로 받아 실제 DB 레코드(Opportunity/Quote/Invoice 등)에 매핑 가능.
 */

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export const DOMAIN_ARTIFACT_SCHEMAS: Record<GtmDomain, JsonSchema> = {
  marketing: {
    type: "object",
    properties: {
      qualified: { type: "boolean", description: "영업 전환 가능한 적격 리드인가" },
      leadScore: { type: "number", description: "0-100 리드 점수" },
      campaign: { type: "string", description: "귀속 캠페인/유입 경로" },
      nextAction: { type: "string", description: "다음 액션 한 줄" },
    },
    required: ["qualified", "leadScore", "nextAction"],
  },
  sales: {
    type: "object",
    properties: {
      customer: { type: "string", description: "고객/회사명" },
      opportunityTitle: { type: "string", description: "기회명" },
      estimatedAmount: { type: "number", description: "예상 견적액(원)" },
      discountPct: { type: "number", description: "할인율(%)" },
      products: { type: "array", items: { type: "string" }, description: "제품/SKU" },
    },
    required: ["customer", "opportunityTitle", "estimatedAmount"],
  },
  presales: {
    type: "object",
    properties: {
      proposalTitle: { type: "string", description: "기술제안 제목" },
      architecture: { type: "string", description: "핵심 구성 요약" },
      components: { type: "array", items: { type: "string" }, description: "구성 요소" },
      risks: { type: "array", items: { type: "string" }, description: "기술 리스크" },
    },
    required: ["proposalTitle", "architecture"],
  },
  engineer: {
    type: "object",
    properties: {
      assetSummary: { type: "string", description: "고객 자산 요약" },
      deploymentSteps: { type: "array", items: { type: "string" }, description: "구축 단계" },
      haRequired: { type: "boolean", description: "HA(이중화) 필요 여부" },
      supportCaseTitle: { type: "string", description: "지원/구축 건명" },
    },
    required: ["assetSummary", "deploymentSteps"],
  },
  cfo: {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["approved", "rejected", "hold"], description: "상업 승인 결정" },
      marginPct: { type: "number", description: "마진율(%)" },
      conditions: { type: "array", items: { type: "string" }, description: "승인 조건" },
      rationale: { type: "string", description: "결정 근거" },
    },
    required: ["decision", "rationale"],
  },
};

export function schemaForDomain(domain: GtmDomain): JsonSchema {
  return DOMAIN_ARTIFACT_SCHEMAS[domain];
}
