import { Prisma, prisma } from "@sangfor/db";
import type { GtmDomain } from "@sangfor/shared/modes";

/**
 * 도메인 메모리 — 종축 도메인별 학습/기록.
 *
 * PolicyMemory 패턴(mail-policy-memory.ts)을 GTM 도메인 축으로 확장한다.
 * 핵심: `domain` 컬럼이 단독-writer 소유 경계 → 도메인별로 오염 없이 학습이 쌓인다.
 *
 * 2계층:
 *  - DomainMemory      : 케이스/규칙/예외 (recall 대상)
 *  - DomainDecisionLog : 입력·결정·게이트결과·인간수정 감사 추적
 *
 * V1 recall 은 임베딩 없이 구조적(tag 겹침 + outcome 가중 + confidence). V2 에서 임베딩 훅 추가.
 */

export type DomainMemoryType = "case" | "rule" | "exception";
export type DomainOutcome = "approved" | "rejected" | "corrected";

export interface DomainMemoryRecord {
  domain: GtmDomain;
  memoryType: DomainMemoryType;
  key: string;
  label: string;
  tags: string[];
  outcome: DomainOutcome | null;
  confidence: number;
  status: string;
  createdAt?: Date;
  embedding?: number[];
}

export interface RecallQuery {
  domain: GtmDomain;
  tags: string[];
}

/** outcome 별 학습 가중치 — 수정된 케이스도 학습 가치가 있다. */
const OUTCOME_WEIGHT: Record<string, number> = {
  approved: 1.0,
  corrected: 0.6,
  rejected: 0.3,
};

/**
 * 순수 함수 recall 스코어: 같은 도메인 후보를 tag 겹침 × outcome 가중 × confidence 로 점수화.
 * 도메인 불일치 / 비활성 / tag 무겹침이면 0 (= recall 대상 아님). DB 불필요 → 테스트 가능.
 */
export function scoreDomainMemory(query: RecallQuery, record: DomainMemoryRecord): number {
  if (record.domain !== query.domain) return 0;
  if (record.status !== "active") return 0;
  if (query.tags.length === 0) return 0;

  const queryTags = new Set(query.tags.map((t) => t.toLowerCase()));
  const overlap = record.tags.filter((t) => queryTags.has(t.toLowerCase())).length;
  if (overlap === 0) return 0;

  const tagScore = overlap / query.tags.length;
  const outcomeWeight = record.outcome ? OUTCOME_WEIGHT[record.outcome] ?? 0.5 : 0.5;
  const confidenceWeight = record.confidence / 100;
  return tagScore * outcomeWeight * confidenceWeight;
}

/** top-K 유사 케이스. 동점은 최신(createdAt) 우선. */
export function recallDomainMemories(
  query: RecallQuery,
  candidates: DomainMemoryRecord[],
  topK = 5,
): DomainMemoryRecord[] {
  return candidates
    .map((record) => ({ record, score: scoreDomainMemory(query, record) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.record.createdAt?.getTime() ?? 0) - (a.record.createdAt?.getTime() ?? 0);
    })
    .slice(0, topK)
    .map((entry) => entry.record);
}

// --- DB layer ---

export async function resolveProjectId(slug = "demo-project") {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

/** 도메인 메모리 1건 갱신/생성 (학습 누적). */
export async function upsertDomainMemory(input: {
  projectSlug?: string;
  domain: GtmDomain;
  memoryType: DomainMemoryType;
  key: string;
  label: string;
  tags?: string[];
  valueJson?: Prisma.InputJsonValue;
  outcome?: DomainOutcome;
  source?: string;
  confidence?: number;
  status?: string;
  embedding?: number[];
}) {
  const projectId = await resolveProjectId(input.projectSlug);
  const data = {
    tags: input.tags ?? [],
    label: input.label,
    valueJson: input.valueJson ?? { value: input.key },
    outcome: input.outcome ?? null,
    source: input.source ?? "agent",
    confidence: input.confidence ?? 80,
    status: input.status ?? "active",
    ...(input.embedding ? { embedding: input.embedding } : {}),
  };
  return prisma.domainMemory.upsert({
    where: {
      projectId_domain_memoryType_key: {
        projectId,
        domain: input.domain,
        memoryType: input.memoryType,
        key: input.key,
      },
    },
    update: data,
    create: {
      projectId,
      domain: input.domain,
      memoryType: input.memoryType,
      key: input.key,
      ...data,
    },
  });
}

/** 결정/핸드오프 1건 기록 (감사 추적 + 피드백 루프). */
export async function recordDomainDecision(input: {
  projectSlug?: string;
  domain: GtmDomain;
  caseRef?: string;
  decisionType: string;
  inputJson?: Prisma.InputJsonValue;
  outputJson?: Prisma.InputJsonValue;
  colorGateJson?: Prisma.InputJsonValue;
  humanEditJson?: Prisma.InputJsonValue;
  outcome?: DomainOutcome;
}) {
  const projectId = await resolveProjectId(input.projectSlug);
  return prisma.domainDecisionLog.create({
    data: {
      projectId,
      domain: input.domain,
      caseRef: input.caseRef ?? null,
      decisionType: input.decisionType,
      inputJson: input.inputJson ?? Prisma.JsonNull,
      outputJson: input.outputJson ?? Prisma.JsonNull,
      colorGateJson: input.colorGateJson ?? Prisma.JsonNull,
      humanEditJson: input.humanEditJson ?? Prisma.JsonNull,
      outcome: input.outcome ?? null,
    },
  });
}

/** 한 도메인의 활성 메모리 전부 로드 (소유 경계: where domain). */
export async function loadDomainMemories(
  domain: GtmDomain,
  projectSlug = "demo-project",
): Promise<DomainMemoryRecord[]> {
  const projectId = await resolveProjectId(projectSlug);
  const rows = await prisma.domainMemory.findMany({
    where: { projectId, domain, status: "active" },
  });
  return rows.map((row) => ({
    domain: row.domain as GtmDomain,
    memoryType: row.memoryType as DomainMemoryType,
    key: row.key,
    label: row.label,
    tags: row.tags,
    outcome: (row.outcome as DomainOutcome | null) ?? null,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.createdAt,
    embedding: (row as { embedding?: number[] }).embedding ?? [],
  }));
}

/** DB 에서 유사 케이스 top-K recall (도메인 격리). */
export async function recallFromDb(
  query: RecallQuery,
  projectSlug = "demo-project",
  topK = 5,
): Promise<DomainMemoryRecord[]> {
  const candidates = await loadDomainMemories(query.domain, projectSlug);
  return recallDomainMemories(query, candidates, topK);
}
