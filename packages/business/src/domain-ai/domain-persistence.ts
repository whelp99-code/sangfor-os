import { prisma as realPrisma } from "@sangfor/db";
import type { GtmDomain } from "@sangfor/shared/modes";
import type { DomainArtifact, DomainCase } from "./domain-agent-runtime";
import { resolveDomainProjectId } from "./domain-memory";

/**
 * 구조화 산출물(artifact.payload.structured) → 실제 DB 레코드 매핑.
 *
 * 도메인 파이프라인을 "데모"에서 "실데이터 반영"으로 끌어올리는 단계.
 *   - 멱등: 레코드 id 를 `dompipe:<kind>:<caseId>` 로 결정론적 생성 → 재실행은 중복 대신 upsert.
 *   - 격리: 모든 테넌트 레코드를 projectSlug→projectId 로 스코프.
 *   - 안전: 구조화 페이로드가 없으면(stub 등) 아무것도 쓰지 않고 skip.
 *
 * 런타임(runDomainStage)에 `persist` 로 주입하면 게이트 통과 케이스만 영속화된다.
 */

export interface DomainPersistInput {
  domain: GtmDomain;
  case: DomainCase;
  artifact: DomainArtifact;
  projectSlug?: string;
}

export interface PersistedRecord {
  entity: string;
  id: string;
}

export interface DomainPersistResult {
  domain: GtmDomain;
  persisted: PersistedRecord[];
  /** 영속화를 건너뛴 이유 (qualified 아님, 구조화 없음 등). */
  skipped?: string;
}

export type DomainPersister = (input: DomainPersistInput) => Promise<DomainPersistResult>;

/** persister 가 쓰는 prisma 메서드만 추린 구조적 타입(실 PrismaClient·테스트 fake 모두 호환). */
type UpsertModel = {
  upsert: (args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<{ id: string }>;
  findUnique: (args: { where: { id: string } }) => Promise<{ id: string; amount?: unknown } | null>;
};
export interface PersistencePrisma {
  opportunity: UpsertModel;
  customer: UpsertModel;
  quote: UpsertModel;
  pocProject: UpsertModel;
  customerAsset: UpsertModel;
  supportCase: UpsertModel;
  invoice: UpsertModel;
}

export interface DomainPersisterDeps {
  prisma?: PersistencePrisma;
  /** projectSlug → projectId. 기본은 domain-memory 의 resolveDomainProjectId. */
  resolveProjectId?: (slug?: string) => Promise<string>;
}

// ---- helpers -------------------------------------------------------------

const idFor = (kind: string, caseId: string) => `dompipe:${kind}:${caseId}`;

function structuredOf(a: DomainArtifact): Record<string, unknown> | null {
  const s = (a.payload as { structured?: unknown } | undefined)?.structured;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : null;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- factory -------------------------------------------------------------

export function createDomainPersister(deps: DomainPersisterDeps = {}): DomainPersister {
  const db = deps.prisma ?? (realPrisma as unknown as PersistencePrisma);
  const resolveProjectId = deps.resolveProjectId ?? resolveDomainProjectId;

  return async ({ domain, case: c, artifact, projectSlug }) => {
    const s = structuredOf(artifact);
    if (!s) return { domain, persisted: [], skipped: "no-structured-payload" };

    const projectId = await resolveProjectId(projectSlug);
    const persisted: PersistedRecord[] = [];
    const oppId = idFor("opp", c.id);
    const custId = idFor("cust", c.id);

    switch (domain) {
      case "marketing": {
        if (s.qualified !== true) return { domain, persisted: [], skipped: "lead-not-qualified" };
        await db.opportunity.upsert({
          where: { id: oppId },
          create: {
            id: oppId,
            projectId,
            title: str(s.opportunityTitle) ?? c.subject,
            stage: "QUALIFIED",
            probability: num(s.leadScore) ?? 20,
            nextAction: str(s.nextAction) ?? null,
          },
          update: {
            stage: "QUALIFIED",
            probability: num(s.leadScore) ?? 20,
            nextAction: str(s.nextAction) ?? null,
          },
        });
        persisted.push({ entity: "Opportunity", id: oppId });
        break;
      }

      case "sales": {
        await db.customer.upsert({
          where: { id: custId },
          create: { id: custId, projectId, name: str(s.customer) ?? "(미상 고객)" },
          update: { name: str(s.customer) ?? "(미상 고객)" },
        });
        persisted.push({ entity: "Customer", id: custId });

        const amount = num(s.estimatedAmount) ?? 0;
        await db.opportunity.upsert({
          where: { id: oppId },
          create: {
            id: oppId,
            projectId,
            customerId: custId,
            title: str(s.opportunityTitle) ?? c.subject,
            stage: "PROPOSAL",
            amount,
          },
          update: { customerId: custId, title: str(s.opportunityTitle) ?? c.subject, stage: "PROPOSAL", amount },
        });
        persisted.push({ entity: "Opportunity", id: oppId });

        // 마진은 sales 스키마에 없으므로 휴리스틱(기본 30%). discountPct 는 참고 저장.
        const marginPct = 30;
        const totalRevenue = amount;
        const totalCost = round2(totalRevenue * (1 - marginPct / 100));
        const quoteId = idFor("quote", c.id);
        await db.quote.upsert({
          where: { id: quoteId },
          create: {
            id: quoteId,
            opportunityId: oppId,
            companyId: projectId,
            status: "draft",
            totalRevenue,
            totalCost,
            marginPct,
            createdBy: "domain-pipeline",
          },
          update: { totalRevenue, totalCost, marginPct },
        });
        persisted.push({ entity: "Quote", id: quoteId });
        break;
      }

      case "presales": {
        const pocId = idFor("poc", c.id);
        await db.pocProject.upsert({
          where: { id: pocId },
          create: {
            id: pocId,
            projectId,
            title: str(s.proposalTitle) ?? c.subject,
            requirements: str(s.architecture) ?? null,
            opportunityId: oppId,
            status: "planning",
          },
          update: { title: str(s.proposalTitle) ?? c.subject, requirements: str(s.architecture) ?? null, opportunityId: oppId },
        });
        persisted.push({ entity: "PocProject", id: pocId });
        break;
      }

      case "engineer": {
        // CustomerAsset.customerId 는 FK(onDelete Cascade) → 대상 고객을 먼저 보장.
        await db.customer.upsert({
          where: { id: custId },
          create: { id: custId, projectId, name: "(도메인 파이프라인 고객)" },
          update: {},
        });
        const assetId = idFor("asset", c.id);
        await db.customerAsset.upsert({
          where: { id: assetId },
          create: {
            id: assetId,
            customerId: custId,
            assetType: "deployment",
            name: truncate(str(s.assetSummary) ?? c.subject, 120),
            status: "active",
            metadata: { deploymentSteps: s.deploymentSteps ?? [], haRequired: s.haRequired ?? false },
          },
          update: {
            name: truncate(str(s.assetSummary) ?? c.subject, 120),
            metadata: { deploymentSteps: s.deploymentSteps ?? [], haRequired: s.haRequired ?? false },
          },
        });
        persisted.push({ entity: "CustomerAsset", id: assetId });

        const supTitle = str(s.supportCaseTitle);
        if (supTitle) {
          const supId = idFor("support", c.id);
          await db.supportCase.upsert({
            where: { id: supId },
            create: { id: supId, customerId: custId, subject: supTitle },
            update: { subject: supTitle },
          });
          persisted.push({ entity: "SupportCase", id: supId });
        }
        break;
      }

      case "cfo": {
        if (s.decision !== "approved") return { domain, persisted: [], skipped: `decision=${String(s.decision)}` };
        // 금액은 연결된 영업기회에서 끌어온다(있으면).
        const opp = await db.opportunity.findUnique({ where: { id: oppId } }).catch(() => null);
        const amount = opp?.amount != null ? Math.round(Number(opp.amount)) : 0;
        const invId = idFor("inv", c.id);
        await db.invoice.upsert({
          where: { id: invId },
          create: { id: invId, amount, total: amount, memo: str(s.rationale) ?? null },
          update: { amount, total: amount, memo: str(s.rationale) ?? null },
        });
        persisted.push({ entity: "Invoice", id: invId });
        break;
      }
    }

    return { domain, persisted };
  };
}

/** 실 prisma + 기본 slug 해소를 쓰는 권장 persister. */
export function createDefaultDomainPersister(): DomainPersister {
  return createDomainPersister();
}
