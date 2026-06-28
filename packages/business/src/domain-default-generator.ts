import type { DomainGenerator } from "./domain-agent-runtime";
import { createOpencodeStructuredGenerator } from "./domain-structured";
import { createOpencodeDomainGenerator, type DomainModelMap } from "./domain-llm";
import { createResilientDomainGenerator } from "./domain-llm-fallback";
import { opencodeHealth, type OpencodeConfig } from "./opencode-client";

/**
 * 권장 기본 DomainGenerator — 구조화(②) + 폴백체인(①)을 한 번에 묶는다.
 *
 *   서버 죽음 → stub
 *   살아있음 → 구조화 출력 시도 → 실패 시 텍스트 출력 → 둘 다 실패 시 stub
 *
 * runDomainPipeline 에 이걸 기본으로 넘기면 "타입 산출물 + 운영 내성"을 동시에 얻는다.
 */
export interface DefaultGeneratorOptions extends OpencodeConfig {
  models?: DomainModelMap;
  system?: string;
  /** false 면 구조화 단계를 빼고 텍스트만 (기본 true). */
  structured?: boolean;
}

export function createDefaultDomainGenerator(opts: DefaultGeneratorOptions = {}): DomainGenerator {
  const chain: DomainGenerator[] = [];
  if (opts.structured !== false) chain.push(createOpencodeStructuredGenerator(opts));
  chain.push(createOpencodeDomainGenerator(opts));
  return createResilientDomainGenerator(chain, {
    healthCheck: () => opencodeHealth(opts),
  });
}
