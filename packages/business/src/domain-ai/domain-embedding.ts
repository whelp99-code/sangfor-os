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

/** Best-effort 임베딩 — 실패(임베더 다운·키 없음)나 빈 벡터면 null. 호출 경로를 절대 막지 않는다. */
export async function safeEmbed(embed: Embedder, text: string): Promise<number[] | null> {
  try {
    const vec = await embed(text);
    return vec.length > 0 ? vec : null;
  } catch {
    return null;
  }
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
  const tags = [...input.tags, ...buildMemoryTags({ domain: input.domain })];
  return recallHybrid(
    { domain: input.domain, tags },
    queryEmbedding,
    candidates,
    input.topK ?? 5,
    input.options ?? {},
  );
}
