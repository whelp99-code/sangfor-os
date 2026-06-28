import type { DomainGenerator, DomainArtifact } from "./domain-agent-runtime";
import { createStubGenerator } from "./domain-agent-runtime";

/**
 * 가용성 폴백 체인.
 *
 * 가용성은 "어떤 모델을 쓸지"의 라우팅 키가 아니라 **죽었을 때 어디로 피할지**에만 쓴다.
 *   healthCheck 실패 → 곧장 stub
 *   else: generators[0] 시도 → 실패 → generators[1] → ... → 전부 실패면 stub
 *
 * generators 는 보통 [구조화 opencode, 텍스트 opencode(백업 모델), ...] 순으로 준다.
 */

export interface ResilientOptions {
  /** 서버 가용성 점검 (예: opencodeHealth). false 면 generators 를 건너뛰고 stub. */
  healthCheck?: () => Promise<boolean>;
  /** 최종 폴백 (기본: createStubGenerator()). */
  stub?: DomainGenerator;
  /** 각 시도 실패를 보고받는 콜백 (로깅/관측). */
  onFallback?: (info: { stage: number; total: number; error: unknown; usingStub: boolean }) => void;
}

export function createResilientDomainGenerator(
  generators: DomainGenerator[],
  opts: ResilientOptions = {},
): DomainGenerator {
  const stub = opts.stub ?? createStubGenerator();

  return async (input): Promise<DomainArtifact> => {
    if (opts.healthCheck) {
      let healthy = false;
      try {
        healthy = await opts.healthCheck();
      } catch {
        healthy = false;
      }
      if (!healthy) {
        opts.onFallback?.({ stage: 0, total: generators.length, error: new Error("health check failed"), usingStub: true });
        return stub(input);
      }
    }

    for (let i = 0; i < generators.length; i++) {
      try {
        return await generators[i](input);
      } catch (error) {
        opts.onFallback?.({
          stage: i + 1,
          total: generators.length,
          error,
          usingStub: i === generators.length - 1,
        });
      }
    }
    return stub(input);
  };
}
