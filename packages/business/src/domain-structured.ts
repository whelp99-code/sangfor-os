import type { GtmDomain } from "@sangfor/shared/modes";
import { DOMAIN_DEFINITIONS } from "./domain-pipeline";
import type { DomainGenerator } from "./domain-agent-runtime";
import { resolveDomainModel, type DomainModelMap } from "./domain-llm";
import { createOpencodeSession, type OpencodeConfig } from "./opencode-client";
import { opencodePromptStructured } from "./opencode-structured";
import { schemaForDomain } from "./domain-artifact-schema";

/**
 * 구조화 출력 DomainGenerator — 도메인별 JSON 스키마로 **타입 산출물**을 받는다.
 * artifact.payload.structured 에 검증된 객체, summary 에는 가독용 요약 문자열.
 */

export interface StructuredGeneratorOptions extends OpencodeConfig {
  models?: DomainModelMap;
  system?: string;
}

/** 구조화 객체 → 한 줄 요약(가독용). 도메인별 핵심 필드 우선. */
export function summarizeStructured(domain: GtmDomain, data: Record<string, unknown>): string {
  const pick = (k: string) => (data[k] === undefined ? "" : `${k}=${JSON.stringify(data[k])}`);
  const keysByDomain: Record<GtmDomain, string[]> = {
    marketing: ["qualified", "leadScore", "nextAction"],
    sales: ["customer", "opportunityTitle", "estimatedAmount", "discountPct"],
    presales: ["proposalTitle", "architecture"],
    engineer: ["assetSummary", "haRequired"],
    cfo: ["decision", "marginPct", "rationale"],
  };
  const parts = keysByDomain[domain].map(pick).filter(Boolean);
  return parts.join(" · ") || JSON.stringify(data).slice(0, 200);
}

export function createOpencodeStructuredGenerator(
  opts: StructuredGeneratorOptions = {},
): DomainGenerator {
  return async ({ domain, prompt }) => {
    const model = resolveDomainModel(domain, opts.models);
    const session = await createOpencodeSession({ ...opts, title: `domain-structured:${domain}` });
    const data = await opencodePromptStructured({
      ...opts,
      sessionID: session.id,
      model,
      prompt,
      schema: schemaForDomain(domain),
      system: opts.system,
    });
    return {
      produces: DOMAIN_DEFINITIONS[domain].produces,
      summary: summarizeStructured(domain, data),
      payload: { model, sessionID: session.id, structured: data },
    };
  };
}
