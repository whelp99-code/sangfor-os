import {
  GTM_PIPELINE,
  type GtmDomain,
} from "@sangfor/shared/modes";
import {
  DOMAIN_DEFINITIONS,
  lensesForDomain,
  buildDomainHandoff,
} from "./domain-pipeline";
import { checkColorGate, type ColorKey } from "./color-agent";
import {
  recallFromDb,
  recordDomainDecision,
  upsertDomainMemory,
  type DomainMemoryRecord,
  type DomainOutcome,
} from "./domain-memory";
import {
  createDefaultDomainGenerator,
  type DefaultGeneratorOptions,
} from "./domain-default-generator";
import type { DomainPersister, DomainPersistResult } from "./domain-persistence";

/**
 * V2 — 도메인 AI 런타임.
 *
 * 각 도메인을 "실제 AI"로 만드는 재사용 엔진:
 *   recall(메모리) → prompt 구성 → generate(LLM, 주입형) → 컬러 렌즈 → 게이트 → 결정기록 → 학습 → 핸드오프
 *
 * LLM/게이트는 주입형(deps)이라 테스트/데모는 stub, 운영은 실제 모델/리뷰를 꽂는다.
 */

export interface DomainCase {
  id: string;
  subject: string;
  tags: string[];
  content?: string;
}

/** 도메인 AI 산출물 */
export interface DomainArtifact {
  produces: string;
  summary: string;
  payload?: Record<string, unknown>;
}

/** LLM 호출 추상화 — recall 된 과거 케이스를 few-shot 으로 받는다. */
export type DomainGenerator = (input: {
  domain: GtmDomain;
  case: DomainCase;
  recalled: DomainMemoryRecord[];
  prompt: string;
}) => Promise<DomainArtifact>;

/** 컬러 게이트 평가 추상화 — 기본은 필요한 렌즈 전부 통과. */
export type ColorGateEvaluator = (input: {
  domain: GtmDomain;
  required: ColorKey[];
  artifact: DomainArtifact;
}) => Promise<{ reviewed: ColorKey[]; failed: ColorKey[] }>;

export interface DomainRuntimeDeps {
  /**
   * LLM 생성기. 생략하면 `createDefaultDomainGenerator(defaultGeneratorOptions)`
   * (구조화→텍스트→stub, opencode 헬스 폴백)가 자동으로 쓰인다.
   */
  generate?: DomainGenerator;
  /** generate 를 생략했을 때 기본 생성기에 넘길 옵션(모델맵·opencode 설정 등). */
  defaultGeneratorOptions?: DefaultGeneratorOptions;
  evaluateGate?: ColorGateEvaluator;
  projectSlug?: string;
  recallTopK?: number;
  /** 학습 저장 끄기 (드라이런). 기본 false. */
  skipLearning?: boolean;
  /**
   * 구조화 산출물 → 실 DB 레코드 영속화기(주입형). 게이트 통과 케이스만 영속화.
   * 생략하면 영속화하지 않는다(데모/테스트 안전). createDomainPersister() 참고.
   */
  persist?: DomainPersister;
}

/** generate 가 주입되면 그대로, 아니면 권장 기본 생성기를 만든다. */
export function resolveDomainGenerator(deps: DomainRuntimeDeps): DomainGenerator {
  return deps.generate ?? createDefaultDomainGenerator(deps.defaultGeneratorOptions);
}

export interface DomainStageResult {
  domain: GtmDomain;
  artifact: DomainArtifact;
  requiredLenses: ColorKey[];
  reviewedLenses: ColorKey[];
  failedLenses: ColorKey[];
  gatePass: boolean;
  recalled: DomainMemoryRecord[];
  handoffTo: GtmDomain | null;
  /** persist 주입 시 영속화 결과(게이트 통과 케이스만). 미주입이면 null. */
  persisted: DomainPersistResult | null;
}

const defaultGate: ColorGateEvaluator = async ({ required }) => ({
  reviewed: required,
  failed: [],
});

/** recall 된 과거 케이스를 few-shot 으로 엮어 도메인 프롬프트를 만든다. */
export function buildDomainPrompt(
  domain: GtmDomain,
  c: DomainCase,
  recalled: DomainMemoryRecord[],
): string {
  const def = DOMAIN_DEFINITIONS[domain];
  const lines: string[] = [];
  lines.push(`[도메인] ${def.label} (${domain})`);
  lines.push(`[책임] 산출물: ${def.produces}; 소유 데이터: ${def.ownedEntities.join(", ")}`);
  lines.push(`[인입] ${c.subject}`);
  if (c.content) lines.push(`[본문] ${c.content}`);
  lines.push(`[태그] ${c.tags.join(", ")}`);
  if (recalled.length > 0) {
    lines.push(`[과거 유사 케이스 ${recalled.length}건 — 참고]`);
    for (const r of recalled) {
      lines.push(`  - ${r.label} (outcome=${r.outcome ?? "n/a"}, conf=${r.confidence})`);
    }
  } else {
    lines.push("[과거 유사 케이스] 없음 (이 도메인의 첫 학습)");
  }
  lines.push(`[지시] 위 맥락으로 ${def.produces} 산출물을 생성하라.`);
  return lines.join("\n");
}

/** 한 도메인 단계 실행. */
export async function runDomainStage(
  domain: GtmDomain,
  c: DomainCase,
  deps: DomainRuntimeDeps,
): Promise<DomainStageResult> {
  const def = DOMAIN_DEFINITIONS[domain];
  const projectSlug = deps.projectSlug ?? "demo-project";
  const evaluateGate = deps.evaluateGate ?? defaultGate;
  const generate = resolveDomainGenerator(deps);

  // 1) recall (도메인 격리)
  const recalled = await recallFromDb({ domain, tags: c.tags }, projectSlug, deps.recallTopK ?? 3);

  // 2) prompt → 3) generate (LLM 주입; 미주입 시 권장 기본 생성기)
  const prompt = buildDomainPrompt(domain, c, recalled);
  const artifact = await generate({ domain, case: c, recalled, prompt });

  // 4) 횡축 컬러 렌즈 → 5) 게이트
  const lenses = lensesForDomain(domain);
  const { reviewed, failed } = await evaluateGate({ domain, required: lenses.required, artifact });
  const gatePass = checkColorGate(lenses.required, reviewed, failed);

  const handoff = buildDomainHandoff(domain);
  const outcome: DomainOutcome = gatePass ? "approved" : "rejected";

  // 6) 결정 기록 (감사)
  await recordDomainDecision({
    projectSlug,
    domain,
    caseRef: c.id,
    decisionType: "agent-stage",
    inputJson: { subject: c.subject, tags: c.tags },
    outputJson: { produces: artifact.produces, summary: artifact.summary, handoffTo: handoff.to },
    colorGateJson: { required: lenses.required, reviewed, failed, pass: gatePass },
    outcome,
  });

  // 7) 학습 (게이트 통과 케이스만 누적)
  if (!deps.skipLearning && gatePass) {
    await upsertDomainMemory({
      projectSlug,
      domain,
      memoryType: "case",
      key: `${domain}:${c.id}`,
      label: `${def.label} — ${c.subject}`,
      tags: c.tags,
      valueJson: { subject: c.subject, produces: artifact.produces, summary: artifact.summary },
      outcome,
      source: "agent",
      confidence: 90,
    });
  }

  // 8) 영속화 (게이트 통과 + persist 주입 시): 구조화 산출물 → 실 DB 레코드
  let persisted: DomainPersistResult | null = null;
  if (gatePass && deps.persist) {
    persisted = await deps.persist({ domain, case: c, artifact, projectSlug });
  }

  return {
    domain,
    artifact,
    requiredLenses: lenses.required,
    reviewedLenses: reviewed,
    failedLenses: failed,
    gatePass,
    recalled,
    handoffTo: gatePass ? handoff.to : null,
    persisted,
  };
}

/** 파이프라인 전체 실행. 게이트 실패 시 그 도메인에서 중단(다음으로 핸드오프 안 함). */
export async function runDomainPipeline(
  c: DomainCase,
  deps: DomainRuntimeDeps,
): Promise<DomainStageResult[]> {
  const results: DomainStageResult[] = [];
  // 기본 생성기를 단계마다 새로 만들지 않도록 파이프라인에서 한 번만 해소해 재사용.
  const stageDeps: DomainRuntimeDeps = { ...deps, generate: resolveDomainGenerator(deps) };
  let cursor: GtmDomain | null = GTM_PIPELINE[0];
  while (cursor) {
    const result = await runDomainStage(cursor, c, stageDeps);
    results.push(result);
    if (!result.gatePass) break; // 게이트 실패 → 같은 도메인 재작업 필요, 핸드오프 중단
    cursor = result.handoffTo;
  }
  return results;
}

/** 데모/테스트용 결정론적 stub 생성기. */
export function createStubGenerator(): DomainGenerator {
  return async ({ domain, case: c, recalled }) => {
    const def = DOMAIN_DEFINITIONS[domain];
    return {
      produces: def.produces,
      summary: `${def.label} 산출물 for "${c.subject}" (recall ${recalled.length}건 반영)`,
      payload: { recalledCount: recalled.length },
    };
  };
}
