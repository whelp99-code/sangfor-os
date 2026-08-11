import type { GtmDomain } from "@sangfor/shared/modes";
import {
  loadDomainMemories,
  scoreDomainMemory,
  NEGATIVE_OUTCOMES,
  type DomainMemoryRecord,
  type RecallQuery,
 buildMemoryTags,
} from "./domain-memory";
import { resolveDefaultProjectSlug } from "../infrastructure/default-project";

/**
 * V2 — 임베딩 기반 의미(semantic) recall.
 *
 * 메인 DB 에 pgvector 가 없으므로 **앱 레이어 코사인 유사도**로 구현(추가 인프라 0).
 * 임베딩 함수는 주입형(Embedder) — 운영은 sangfor-rag/OpenAI 호환 임베딩, 테스트는 stub.
 *
 * 하이브리드: 임베딩이 있으면 cosine, 없으면 구조적 태그 점수로 폴백.
 * 도메인 격리(소유 경계)와 active 상태는 두 경로 모두에서 강제된다.
 */

export type Embedder = (text: string) => Promise<number[]>;

export interface SafeEmbedOptions {
  /** 재시도 횟수(기본 1). 0이면 재시도하지 않는다. */
  readonly retries?: number;
  /** 재시도 전 지연(ms, 기본 200). 테스트는 0을 주입한다. */
  readonly retryDelayMs?: number;
}

export interface EmbedderHealth {
  /** 연속 실패 횟수 — 성공 시 0으로 복귀. */
  readonly consecutiveFailures: number;
  /** 마지막 실패 사유(있으면). */
  readonly lastFailureReason?: string;
  /** 마지막 실패 시각(ISO). */
  readonly lastFailureAt?: string;
}

/**
 * 임베더 상태 — 프로세스 로컬. console.warn 만으로는 임베더 장애가 관측되지 않아
 * recall 품질 저하의 원인을 사후에 추적할 수 없었다. 카운터로 승격해 호출자가
 * (대시보드·헬스 라우트 등) 저하 상태를 읽을 수 있게 한다.
 */
let embedderHealth: EmbedderHealth = { consecutiveFailures: 0 };

/** 현재 임베더 상태 스냅숏. */
export function getEmbedderHealth(): EmbedderHealth {
  return embedderHealth;
}

/** 상태 초기화 — 테스트 격리용. */
export function resetEmbedderHealth(): void {
  embedderHealth = { consecutiveFailures: 0 };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Best-effort 임베딩 — 경계 재시도 후에도 실패하거나 빈 벡터면 null.
 * 호출 경로를 절대 막지 않되, 일시적 장애는 재시도로 흡수하고 지속적 장애는
 * {@link getEmbedderHealth} 로 관측 가능하게 남긴다.
 */
export async function safeEmbed(
  embed: Embedder,
  text: string,
  options: SafeEmbedOptions = {},
): Promise<number[] | null> {
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 200;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const vec = await embed(text);
      if (vec.length > 0) {
        embedderHealth = { consecutiveFailures: 0 };
        return vec;
      }
      // 빈 벡터는 재시도해도 같을 가능성이 높다 — 실패로 기록하되 즉시 중단.
      lastError = new Error("empty embedding vector");
      break;
    } catch (err) {
      lastError = err;
      if (attempt < retries && retryDelayMs > 0) await sleep(retryDelayMs);
    }
  }

  const reason = (lastError as Error)?.message ?? String(lastError);
  embedderHealth = {
    consecutiveFailures: embedderHealth.consecutiveFailures + 1,
    lastFailureReason: reason,
    lastFailureAt: new Date().toISOString(),
  };
  // 실패 증거를 남기고 저하 — 오퍼레이터가 임베더 다운을 알아챌 수 있어야 한다.
  console.warn(`[domain-embedder] embed_failed: ${reason}`);
  return null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface HybridRecallOptions {
  /** 임베딩 점수 비중 (0..1). 나머지는 태그 점수. 기본 0.7. */
  embeddingWeight?: number;
}

/** 한 후보의 하이브리드 점수. 도메인 불일치/비활성은 0. */
export function hybridScore(
  query: RecallQuery,
  queryEmbedding: number[] | null,
  record: DomainMemoryRecord,
  options: HybridRecallOptions = {},
): number {
  const tagScore = scoreDomainMemory(query, record);

  const hasEmbedding =
    !!queryEmbedding && queryEmbedding.length > 0 && !!record.embedding && record.embedding.length > 0;

  // 임베더 차원 불일치(예: hash 256 vs openai 1536 혼재)면 의미 점수만 제외하고
  // 태그 점수는 온전히 유지 — 이질 임베딩이 기존 recall 을 끌어내리지 않는다.
  if (!hasEmbedding || queryEmbedding!.length !== record.embedding!.length) return tagScore;

  // 반려/되돌림(negative outcome)은 의미유사도로도 되살리지 않는다 — 태그 경로와 동일한 negative-learning 억제.
  if (record.domain !== query.domain) return 0;
  if (record.status !== "active") return 0;
  if (record.outcome !== null && NEGATIVE_OUTCOMES.has(record.outcome)) return 0;

  const sim = Math.max(0, cosineSimilarity(queryEmbedding!, record.embedding!));
  const weight = options.embeddingWeight ?? 0.7;
  return weight * sim + (1 - weight) * tagScore;
}

/** 하이브리드 top-K. 동점은 최신 우선. */
export function recallHybrid(
  query: RecallQuery,
  queryEmbedding: number[] | null,
  candidates: DomainMemoryRecord[],
  topK = 5,
  options: HybridRecallOptions = {},
): DomainMemoryRecord[] {
  const suppressedKeys = new Set(
    candidates.filter((r) => r.outcome !== null && NEGATIVE_OUTCOMES.has(r.outcome)).map((r) => r.key),
  );
  return candidates
    .map((record) => ({
      record,
      score: suppressedKeys.has(record.key) ? 0 : hybridScore(query, queryEmbedding, record, options),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.record.createdAt?.getTime() ?? 0) - (a.record.createdAt?.getTime() ?? 0);
    })
    .slice(0, topK)
    .map((entry) => entry.record);
}

/** DB 에서 의미 recall: 후보 로드 → 쿼리 임베딩 → 하이브리드 top-K (도메인 격리). */
export async function recallSemanticFromDb(input: {
  domain: GtmDomain;
  tags: string[];
  queryText: string;
  embed: Embedder;
  projectSlug?: string;
  topK?: number;
  options?: HybridRecallOptions;
}): Promise<DomainMemoryRecord[]> {
  const candidates = await loadDomainMemories(input.domain, input.projectSlug ?? (await resolveDefaultProjectSlug()));
  // 임베더 실패(네트워크·키 없음) 시 태그 전용 하이브리드로 우아하게 저하.
  const queryEmbedding = await safeEmbed(input.embed, input.queryText);
  // A-4: always include the shared vocabulary tags so buildMemoryTags-written
  // memories are recallable regardless of what raw tags the caller passed.
  // 중복 제거 필수 — 호출자가 이미 domain:<d> 를 넘겼으면 태그가 겹쳐
  // tagScore 의 분모(query.tags.length)만 부풀고 점수가 실제보다 낮아진다.
  const tags = [...new Set([...input.tags, ...buildMemoryTags({ domain: input.domain })])];
  return recallHybrid(
    { domain: input.domain, tags },
    queryEmbedding,
    candidates,
    input.topK ?? 5,
    input.options ?? {},
  );
}
