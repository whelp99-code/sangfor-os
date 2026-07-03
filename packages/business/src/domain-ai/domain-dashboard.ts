import { GTM_PIPELINE, type GtmDomain } from "@sangfor/shared/modes";
import { pipelineOverview } from "./domain-pipeline";

/**
 * 종축 대시보드 스냅샷 — 파이프라인 개요 + 도메인별 메모리/결정 통계.
 * 데이터 접근은 주입형(DomainStatsLoader)이라 prisma 없이 테스트 가능.
 */

export interface OutcomeBreakdown {
  approved: number;
  rejected: number;
  corrected: number;
}

export interface RecentDecision {
  outcome: string | null;
  at: Date;
}

export interface DomainStats {
  memoryCount: number;
  decisionCount: number;
  lastDecisionAt: Date | null;
  lastOutcome: string | null;
  /** outcome 별 결정 분해. 생략 시 0 으로 채운다(하위호환). */
  outcomeBreakdown?: OutcomeBreakdown;
  /** 최근 결정(최신순). 생략 시 빈 배열. */
  recentDecisions?: RecentDecision[];
}

export type DomainStatsLoader = (domain: GtmDomain) => Promise<DomainStats>;

export interface DomainDashboardRow {
  domain: GtmDomain;
  label: string;
  produces: string;
  handoffTo: GtmDomain | null;
  requiredLenses: string[];
  ownedEntities: string[];
  memoryCount: number;
  decisionCount: number;
  lastDecisionAt: string | null;
  lastOutcome: string | null;
  outcomeBreakdown: OutcomeBreakdown;
  recentDecisions: { outcome: string | null; at: string }[];
}

export interface DomainDashboardSnapshot {
  pipeline: GtmDomain[];
  rows: DomainDashboardRow[];
  totals: {
    memories: number;
    decisions: number;
    approved: number;
    rejected: number;
    corrected: number;
  };
  /** 스냅샷 직렬화 시각(클라이언트의 "최근 갱신" 표시용). */
  generatedAt: string;
}

const ZERO_BREAKDOWN: OutcomeBreakdown = { approved: 0, rejected: 0, corrected: 0 };

export async function buildDomainDashboardSnapshot(
  loadStats: DomainStatsLoader,
): Promise<DomainDashboardSnapshot> {
  const overview = pipelineOverview();
  const rows: DomainDashboardRow[] = [];
  let memories = 0;
  let decisions = 0;
  let approved = 0;
  let rejected = 0;
  let corrected = 0;

  for (const o of overview) {
    const s = await loadStats(o.from);
    const breakdown = s.outcomeBreakdown ?? ZERO_BREAKDOWN;
    memories += s.memoryCount;
    decisions += s.decisionCount;
    approved += breakdown.approved;
    rejected += breakdown.rejected;
    corrected += breakdown.corrected;
    rows.push({
      domain: o.from,
      label: o.label,
      produces: o.artifact,
      handoffTo: o.to,
      requiredLenses: o.requiredLenses,
      ownedEntities: o.ownedEntities,
      memoryCount: s.memoryCount,
      decisionCount: s.decisionCount,
      lastDecisionAt: s.lastDecisionAt ? s.lastDecisionAt.toISOString() : null,
      lastOutcome: s.lastOutcome,
      outcomeBreakdown: { ...breakdown },
      recentDecisions: (s.recentDecisions ?? []).map((d) => ({
        outcome: d.outcome,
        at: d.at.toISOString(),
      })),
    });
  }

  return {
    pipeline: [...GTM_PIPELINE],
    rows,
    totals: { memories, decisions, approved, rejected, corrected },
    generatedAt: new Date().toISOString(),
  };
}

interface PrismaLike {
  project: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
  domainMemory: { count: (args: unknown) => Promise<number> };
  domainDecisionLog: {
    count: (args: unknown) => Promise<number>;
    findFirst: (args: unknown) => Promise<{ createdAt: Date; outcome: string | null } | null>;
    findMany: (args: unknown) => Promise<{ createdAt: Date; outcome: string | null }[]>;
    groupBy: (args: unknown) => Promise<{ outcome: string | null; _count: { _all: number } }[]>;
  };
}

/** prisma 기반 기본 통계 로더 (도메인 격리: where domain). */
export function createPrismaDomainStatsLoader(
  prismaLike: PrismaLike,
  projectSlug = "demo-project",
): DomainStatsLoader {
  let projectIdPromise: Promise<string | null> | null = null;
  const getProjectId = () => {
    if (!projectIdPromise) {
      projectIdPromise = prismaLike.project
        .findUnique({ where: { slug: projectSlug } })
        .then((p) => p?.id ?? null);
    }
    return projectIdPromise;
  };

  return async (domain) => {
    const projectId = await getProjectId();
    if (!projectId) {
      return { memoryCount: 0, decisionCount: 0, lastDecisionAt: null, lastOutcome: null };
    }
    const [memoryCount, decisionCount, recent, grouped] = await Promise.all([
      prismaLike.domainMemory.count({ where: { projectId, domain, status: "active" } }),
      prismaLike.domainDecisionLog.count({ where: { projectId, domain } }),
      prismaLike.domainDecisionLog.findMany({
        where: { projectId, domain },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, outcome: true },
      }),
      prismaLike.domainDecisionLog.groupBy({
        by: ["outcome"],
        where: { projectId, domain },
        _count: { _all: true },
      }),
    ]);

    const outcomeBreakdown: OutcomeBreakdown = { approved: 0, rejected: 0, corrected: 0 };
    for (const g of grouped) {
      if (g.outcome === "approved") outcomeBreakdown.approved = g._count._all;
      else if (g.outcome === "rejected") outcomeBreakdown.rejected = g._count._all;
      else if (g.outcome === "corrected") outcomeBreakdown.corrected = g._count._all;
    }

    const last = recent[0] ?? null;
    return {
      memoryCount,
      decisionCount,
      lastDecisionAt: last?.createdAt ?? null,
      lastOutcome: last?.outcome ?? null,
      outcomeBreakdown,
      recentDecisions: recent.map((d) => ({ outcome: d.outcome, at: d.createdAt })),
    };
  };
}
