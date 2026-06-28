import type { GtmDomain } from "@sangfor/shared/modes";
import {
  loadDomainMemories,
  scoreDomainMemory,
  type DomainMemoryRecord,
  type RecallQuery,
} from "./domain-memory";

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

  if (!hasEmbedding) return tagScore;

  // 임베딩 경로: 태그 무겹침이어도 의미 유사하면 recall 되도록 — 단 격리/active 는 강제.
  if (record.domain !== query.domain) return 0;
  if (record.status !== "active") return 0;

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
  return candidates
    .map((record) => ({ record, score: hybridScore(query, queryEmbedding, record, options) }))
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
  const candidates = await loadDomainMemories(input.domain, input.projectSlug ?? "demo-project");
  const queryEmbedding = await input.embed(input.queryText);
  return recallHybrid(
    { domain: input.domain, tags: input.tags },
    queryEmbedding,
    candidates,
    input.topK ?? 5,
    input.options ?? {},
  );
}
