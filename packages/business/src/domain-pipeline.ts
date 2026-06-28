import {
  GTM_PIPELINE,
  nextGtmDomain,
  type GtmDomain,
} from "@sangfor/shared/modes";
import {
  routeColorAgents,
  type ColorKey,
  type ColorRoutingInput,
  type ColorRoutingResult,
} from "./color-agent";

/**
 * 종축(업무 도메인) × 횡축(컬러 렌즈) 2축 파이프라인.
 *
 * - 종축: GTM 도메인 순서 (마케팅 → 영업 → 프리세일즈 → 엔지니어 → CFO). 도메인 AI가 추가되는 축.
 * - 횡축: 각 도메인 산출물이 통과해야 하는 컬러 렌즈. 기존 routeColorAgents 재사용.
 *
 * 두 축은 직교한다. 도메인이 늘어도 렌즈는 6개 그대로.
 */

export interface DomainDefinition {
  domain: GtmDomain;
  /** 한글 라벨 */
  label: string;
  /** 이 도메인이 단독 writer 인 데이터 엔티티 (소유 경계) */
  ownedEntities: string[];
  /** 다음 도메인으로 넘기는 산출물 */
  produces: string;
  /** 핸드오프 대상 도메인 (파이프라인 마지막이면 null) */
  next: GtmDomain | null;
  /** routeColorAgents 입력 프리셋 — 이 도메인 산출물의 전형적 리뷰 속성 */
  routingPreset: ColorRoutingInput;
  /** routeColorAgents 로 표현 못 하는 도메인 고유 렌즈 (예: 운영=purple) */
  extraRequiredLenses: ColorKey[];
}

function preset(overrides: Partial<ColorRoutingInput>): ColorRoutingInput {
  return {
    artifactType: "generic",
    riskLevel: "low",
    isCustomerFacing: false,
    hasRestrictedData: false,
    isCommercial: false,
    affectsUI: false,
    affectsArchitecture: false,
    ...overrides,
  };
}

export const DOMAIN_DEFINITIONS: Record<GtmDomain, DomainDefinition> = {
  marketing: {
    domain: "marketing",
    label: "마케팅",
    ownedEntities: ["Lead", "Campaign"],
    produces: "qualified-lead",
    next: "sales",
    // 비즈니스 가치(orange) + 콘텐츠 UX(teal)
    routingPreset: preset({ artifactType: "marketing-content", isCommercial: true, affectsUI: true }),
    extraRequiredLenses: [],
  },
  sales: {
    domain: "sales",
    label: "영업",
    ownedEntities: ["Customer", "Opportunity", "Quote"],
    produces: "opportunity-with-quote",
    next: "presales",
    // 비즈니스(orange) + 위험(red) + 고객대면 문서(gray)
    routingPreset: preset({
      artifactType: "quote",
      isCommercial: true,
      hasRestrictedData: true,
      isCustomerFacing: true,
    }),
    extraRequiredLenses: [],
  },
  presales: {
    domain: "presales",
    label: "프리세일즈",
    ownedEntities: ["PocProject", "GeneratedDocument"],
    produces: "technical-proposal",
    next: "engineer",
    // 기술(blue) + 고객대면 문서(gray)
    routingPreset: preset({
      artifactType: "technical-proposal",
      affectsArchitecture: true,
      isCustomerFacing: true,
    }),
    extraRequiredLenses: [],
  },
  engineer: {
    domain: "engineer",
    label: "엔지니어(SE/현장)",
    ownedEntities: ["CustomerAsset", "SupportCase", "DeliveryProject"],
    produces: "asset-handoff",
    next: "cfo",
    // 기술(blue) + 보안(red) + 운영/배포(purple)
    routingPreset: preset({
      artifactType: "field-deployment",
      affectsArchitecture: true,
      hasRestrictedData: true,
    }),
    extraRequiredLenses: ["purple"],
  },
  cfo: {
    domain: "cfo",
    label: "CFO",
    ownedEntities: ["Invoice", "Cashflow", "FinanceProject"],
    produces: "commercial-approval",
    next: null,
    // 비즈니스(orange) + 위험(red)
    routingPreset: preset({
      artifactType: "commercial-approval",
      isCommercial: true,
      hasRestrictedData: true,
    }),
    extraRequiredLenses: [],
  },
};

/** 도메인 산출물이 통과해야 하는 컬러 렌즈를 계산한다. routeColorAgents 결과 + 도메인 고유 렌즈. */
export function lensesForDomain(
  domain: GtmDomain,
  overrides?: Partial<ColorRoutingInput>,
): ColorRoutingResult {
  const def = DOMAIN_DEFINITIONS[domain];
  const base = routeColorAgents({ ...def.routingPreset, ...overrides });
  const required = [...new Set<ColorKey>([...base.required, ...def.extraRequiredLenses])];
  const optional = base.optional.filter((c) => !required.includes(c));
  return {
    required,
    optional,
    rationale: `domain ${domain}: ${base.rationale}${
      def.extraRequiredLenses.length ? ` + domain lenses [${def.extraRequiredLenses.join(", ")}]` : ""
    }`,
  };
}

export interface DomainHandoff {
  from: GtmDomain;
  to: GtmDomain | null;
  artifact: string;
  requiredLenses: ColorKey[];
}

/** 한 도메인의 산출물 → 다음 도메인 핸드오프 기술자(descriptor). */
export function buildDomainHandoff(
  domain: GtmDomain,
  overrides?: Partial<ColorRoutingInput>,
): DomainHandoff {
  const def = DOMAIN_DEFINITIONS[domain];
  return {
    from: domain,
    to: def.next,
    artifact: def.produces,
    requiredLenses: lensesForDomain(domain, overrides).required,
  };
}

/** 파이프라인 전체 개요 (대시보드/디버깅용). */
export function pipelineOverview(): Array<DomainHandoff & { label: string; ownedEntities: string[] }> {
  return GTM_PIPELINE.map((domain) => {
    const def = DOMAIN_DEFINITIONS[domain];
    const handoff = buildDomainHandoff(domain);
    return { ...handoff, label: def.label, ownedEntities: def.ownedEntities };
  });
}

export { GTM_PIPELINE, nextGtmDomain, type GtmDomain };
