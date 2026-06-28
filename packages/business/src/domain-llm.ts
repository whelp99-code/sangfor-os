import type { GtmDomain } from "@sangfor/shared/modes";
import { DOMAIN_DEFINITIONS } from "./domain-pipeline";
import type { DomainGenerator } from "./domain-agent-runtime";
import {
  createOpencodeSession,
  opencodePrompt,
  type OpencodeConfig,
  type OpencodeModel,
} from "./opencode-client";

/**
 * 도메인 AI 런타임의 실제 LLM 백엔드를 opencode(+OpenAI ChatGPT OAuth)로 연결한다.
 *
 * 권장 라우팅(앞선 설계): 모델은 "활성화 여부"가 아니라 **도메인별 적합성**으로 선택.
 * 도메인→모델 매핑은 주입형(overrides), 미지정 시 env 기본 모델로 폴백.
 */

export type DomainModelMap = Partial<Record<GtmDomain, OpencodeModel>>;

/** env 기반 기본 OpenAI 모델 (opencode 의 /models 에서 보이는 modelID). */
export function defaultOpenAiModel(): OpencodeModel {
  return {
    providerID: process.env.OPENCODE_PROVIDER ?? "openai",
    modelID: process.env.OPENCODE_MODEL ?? "gpt-5",
  };
}

/** 도메인 → 모델. override 우선, 없으면 기본 모델. (availability 는 라우팅 키가 아님) */
export function resolveDomainModel(domain: GtmDomain, overrides?: DomainModelMap): OpencodeModel {
  return overrides?.[domain] ?? defaultOpenAiModel();
}

export interface OpencodeGeneratorOptions extends OpencodeConfig {
  /** 도메인별 모델 라우팅 테이블 (예: cfo/engineer=강추론, marketing=경량). */
  models?: DomainModelMap;
  /** 공통 system 프롬프트 (선택). */
  system?: string;
}

/**
 * opencode 백엔드 DomainGenerator.
 * 런타임이 만든 prompt(= recall few-shot 포함)를 그대로 opencode 세션에 보내고,
 * 도메인별로 라우팅된 모델로 산출물 텍스트를 받는다.
 */
export function createOpencodeDomainGenerator(opts: OpencodeGeneratorOptions = {}): DomainGenerator {
  return async ({ domain, prompt }) => {
    const model = resolveDomainModel(domain, opts.models);
    const session = await createOpencodeSession({ ...opts, title: `domain:${domain}` });
    const text = await opencodePrompt({
      ...opts,
      sessionID: session.id,
      model,
      prompt,
      system: opts.system,
    });
    return {
      produces: DOMAIN_DEFINITIONS[domain].produces,
      summary: text || `(빈 응답: ${model.providerID}/${model.modelID})`,
      payload: { model, sessionID: session.id },
    };
  };
}
