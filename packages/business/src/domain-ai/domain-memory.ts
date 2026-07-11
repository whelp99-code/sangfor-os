import { Prisma, prisma } from "@sangfor/db";
import type { GtmDomain } from "@sangfor/shared/modes";
import { resolveDefaultProjectSlug } from "../infrastructure/default-project";
import { recordDecision } from "../governance/ai-decision";
import type { DecisionActorKey } from "../governance/ai-decision-policy";

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

// ─── Tag vocabulary ────────────────────────────────────────────────────────────

/**
 * Build a normalized, lowercased tag set for BOTH write and recall.
 * Guarantees write/recall symmetry so stored memories are actually found.
 *
 * Tags emitted: `domain:<domain>` always; `entity:<entityType>` and
 * `intent:<intentTag>` when provided.  Falsy parts are dropped.
 */
export function buildMemoryTags(input: {
  domain: string;
  entityType?: string;
  intentTag?: string;
}): string[] {
  return [
    `domain:${input.domain}`,
    input.entityType ? `entity:${input.entityType}` : undefined,
    input.intentTag ? `intent:${input.intentTag}` : undefined,
  ]
    .filter((t): t is string => Boolean(t))
    .map((t) => t.toLowerCase());
}

export interface DomainMemoryRecord {
  domain: GtmDomain;
  memoryType: DomainMemoryType;
  key: string;
  label: string;
  tags: string[];
  outcome: DomainOutcome | null;
  confidence: number;
  status: string;
  /** 'human' | 'agent' — human-confirmed memories get a recall bonus. */
  source?: string;
  createdAt?: Date;
  embedding?: number[];
}

export interface RecallQuery {
  domain: GtmDomain;
  tags: string[];
}

/**
 * outcome 별 학습 가중치.
 * - approved/corrected: 양수(추천 대상)
 * - rejected / human-reverted: 음수 → score <= 0 → recall 대상 제외됨 (negative learning)
 */
const OUTCOME_WEIGHT: Record<string, number> = {
  approved: 1.0,
  corrected: 0.6,
  rejected: -0.3,
  "human-reverted": -0.3,
};

/** source='human' 에 추가되는 recall 보너스. */
const HUMAN_SOURCE_BONUS = 0.15;

/**
 * 순수 함수 recall 스코어: 같은 도메인 후보를 tag 겹침 × outcome 가중 × confidence 로 점수화.
 * 도메인 불일치 / 비활성 / tag 무겹침이면 0 (= recall 대상 아님). DB 불필요 → 테스트 가능.
 * rejected 는 음수 가중치 → score <= 0 → recallDomainMemories 에서 자동 필터됨 (negative learning).
 */
export function scoreDomainMemory(query: RecallQuery, record: DomainMemoryRecord): number {
  if (record.domain !== query.domain) return 0;
  if (record.status !== "active") return 0;
  if (query.tags.length === 0) return 0;

  const queryTags = new Set(query.tags.map((t) => t.toLowerCase()));
  const overlap = record.tags.filter((t) => queryTags.has(t.toLowerCase())).length;
  if (overlap === 0) return 0;

  const tagScore = overlap / query.tags.length;
  const outcomeWeight = record.outcome ? (OUTCOME_WEIGHT[record.outcome] ?? 0.5) : 0.5;
  const confidenceWeight = record.confidence / 100;
  const humanBonus = record.source === "human" ? HUMAN_SOURCE_BONUS : 0;
  return tagScore * outcomeWeight * confidenceWeight + humanBonus;
}

const NEGATIVE_OUTCOMES = new Set(["rejected", "human-reverted"]);

/**
 * top-K 유사 케이스. 동점은 최신(createdAt) 우선.
 *
 * Cross-candidate suppression (A-3 / PLAN §7 / Gate 9): 같은 key의 negative
 * 메모리(rejected/human-reverted)가 존재하면, 그 key의 positive 메모리도 recall
 * 에서 억제된다 — 사람이 한 번 뒤집은 케이스가 다른 경로(rule/exception 행)로
 * 계속 추천되는 것을 막는다. `excludeCaseRef` 는 해당 caseRef 로 시작하는 key 의
 * 메모리를 통째로 제외한다(자기 케이스의 이력이 자기 재생성에 재주입되는 것 방지).
 */
export function recallDomainMemories(
  query: RecallQuery,
  candidates: DomainMemoryRecord[],
  topK = 5,
  options?: { excludeCaseRef?: string },
): DomainMemoryRecord[] {
  const suppressedKeys = new Set(
    candidates
      .filter((r) => r.outcome !== null && NEGATIVE_OUTCOMES.has(r.outcome))
      .map((r) => r.key),
  );
  return candidates
    .filter((r) => !options?.excludeCaseRef || !r.key.startsWith(options.excludeCaseRef))
    .map((record) => ({
      record,
      score: suppressedKeys.has(record.key) ? 0 : scoreDomainMemory(query, record),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.record.createdAt?.getTime() ?? 0) - (a.record.createdAt?.getTime() ?? 0);
    })
    .slice(0, topK)
    .map((entry) => entry.record);
}

// --- DB layer ---

export async function resolveDomainProjectId(slug?: string) {
  const resolved = slug ?? await resolveDefaultProjectSlug();
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: resolved } });
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
  const projectId = await resolveDomainProjectId(input.projectSlug);
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

/**
 * 결정/핸드오프 1건 기록 (감사 추적 + 피드백 루프).
 * A-2 (2026-07-10): now a thin delegate into `recordDecision()` — every row is
 * tier-gated with actor/actionType/policyVersion stamps. The 2nd direct writer
 * to the canonical table is gone; kept as a compatibility wrapper for the
 * domain-flow call sites. New code should call `recordDecision()` directly.
 */
const DOMAIN_ACTOR: Record<string, DecisionActorKey> = {
  marketing: "marketing",
  sales: "sales",
  sales_support: "sales",
  presales: "presales",
  engineer: "engineer",
  cfo: "cfo",
};

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
  actor?: DecisionActorKey;
}): Promise<{ id: string }> {
  const projectId = await resolveDomainProjectId(input.projectSlug);
  const created = await recordDecision({
    projectId,
    domain: input.domain,
    actor: input.actor ?? DOMAIN_ACTOR[input.domain] ?? "sales",
    actionType: input.decisionType,
    caseRef: input.caseRef ?? null,
    decisionType: input.decisionType,
    outcome: input.outcome ?? null,
    input: input.inputJson,
    output: input.outputJson,
    humanEdit: input.humanEditJson,
    colorGate: input.colorGateJson,
  });
  // recordDecision swallows errors by contract; this wrapper's callers
  // (recordHumanDecision 등) historically saw failures propagate — keep that.
  if (!created) throw new Error("domain_decision_log_failed");
  return created;
}

/** 한 도메인의 활성 메모리 전부 로드 (소유 경계: where domain). */
export async function loadDomainMemories(
  domain: GtmDomain,
  projectSlug?: string,
): Promise<DomainMemoryRecord[]> {
  const projectId = await resolveDomainProjectId(projectSlug);
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
    source: (row as { source?: string }).source ?? "agent",
    createdAt: row.createdAt,
    embedding: (row as { embedding?: number[] }).embedding ?? [],
  }));
}

/** DB 에서 유사 케이스 top-K recall (도메인 격리). */
export async function recallFromDb(
  query: RecallQuery,
  projectSlug?: string,
  topK = 5,
): Promise<DomainMemoryRecord[]> {
  const candidates = await loadDomainMemories(query.domain, projectSlug);
  return recallDomainMemories(query, candidates, topK);
}
