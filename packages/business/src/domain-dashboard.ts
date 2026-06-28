import { GTM_PIPELINE, type GtmDomain } from "@sangfor/shared/modes";
import { pipelineOverview } from "./domain-pipeline";

/**
 * 종축 대시보드 스냅샷 — 파이프라인 개요 + 도메인별 메모리/결정 통계.
 * 데이터 접근은 주입형(DomainStatsLoader)이라 prisma 없이 테스트 가능.
 */

export interface DomainStats {
  memoryCount: number;
  decisionCount: number;
  lastDecisionAt: Date | null;
  lastOutcome: string | null;
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
}

export interface DomainDashboardSnapshot {
  pipeline: GtmDomain[];
  rows: DomainDashboardRow[];
  totals: { memories: number; decisions: number };
}

export async function buildDomainDashboardSnapshot(
  loadStats: DomainStatsLoader,
): Promise<DomainDashboardSnapshot> {
  const overview = pipelineOverview();
  const rows: DomainDashboardRow[] = [];
  let memories = 0;
  let decisions = 0;

  for (const o of overview) {
    const s = await loadStats(o.from);
    memories += s.memoryCount;
    decisions += s.decisionCount;
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
    });
  }

  return { pipeline: [...GTM_PIPELINE], rows, totals: { memories, decisions } };
}

interface PrismaLike {
  project: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
  domainMemory: { count: (args: unknown) => Promise<number> };
  domainDecisionLog: {
    count: (args: unknown) => Promise<number>;
    findFirst: (args: unknown) => Promise<{ createdAt: Date; outcome: string | null } | null>;
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
    const [memoryCount, decisionCount, last] = await Promise.all([
      prismaLike.domainMemory.count({ where: { projectId, domain, status: "active" } }),
      prismaLike.domainDecisionLog.count({ where: { projectId, domain } }),
      prismaLike.domainDecisionLog.findFirst({
        where: { projectId, domain },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, outcome: true },
      }),
    ]);
    return {
      memoryCount,
      decisionCount,
      lastDecisionAt: last?.createdAt ?? null,
      lastOutcome: last?.outcome ?? null,
    };
  };
}
