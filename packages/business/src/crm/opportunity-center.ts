import { prisma as realPrisma } from "@sangfor/db";
import { z } from "zod";

import { logStateTransition } from "../governance/audit";
import { recordDecision } from "../governance/ai-decision";
import { caseRefFor } from "../infrastructure/case-ref";
import { resolveDefaultProjectSlug } from "../infrastructure/default-project";
import { formatDealCode } from "./deal-code";
import {
  CANONICAL_STAGES,
  normalizeOpportunityStage,
  nextOpportunityStage,
  validateOpportunityStageOrder,
  validateRegistrationGate,
} from "./opportunity-stage";

/**
 * Structural prisma type covering only the methods used by the list/create/
 * stage-transition paths below (mirrors domain-persistence.ts:38's
 * `PersistencePrisma` DI seam — real PrismaClient and test fakes both satisfy
 * this shape). Test-only injection point; production callers always default
 * to the real client.
 */
export interface OpportunityCenterPrisma {
  project: { findUniqueOrThrow: (args: { where: { slug: string } }) => Promise<{ id: string }> };
  opportunity: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: any) => Promise<any[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUniqueOrThrow: (args: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (args: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: (args: any) => Promise<any>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opportunityStageEvent: { create: (args: any) => Promise<any> };
  $queryRaw: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  $transaction: <T>(fn: (tx: OpportunityCenterPrisma) => Promise<T>) => Promise<T>;
}

export interface OpportunityCenterDeps {
  prisma?: OpportunityCenterPrisma;
}

const stageInput = z
  .enum([
    "LEAD",
    "QUALIFIED",
    "PROPOSAL",
    "POC",
    "NEGOTIATION",
    "WON",
    "LOST",
    "lead",
    "qualified",
    "proposal",
    "poc",
    "negotiation",
    "won",
    "lost",
    "discovery",
    "qualification",
  ])
  .transform(normalizeOpportunityStage);

export const createOpportunitySchema = z.object({
  projectSlug: z.string().optional(),
  title: z.string().min(2),
  customerId: z.string().optional(),
  partnerId: z.string().optional(),
  stage: stageInput.default("LEAD"),
  amount: z.number().optional(),
  probability: z.number().min(0).max(100).default(20),
  closeDate: z.string().datetime().optional(),
  nextAction: z.string().optional(),
});

export const updateOpportunitySchema = z.object({
  title: z.string().min(2).optional(),
  stage: stageInput.optional(),
  amount: z.number().optional(),
  // probability: manual forecast field — intentionally writable by the user (not auto-computed).
  probability: z.number().min(0).max(100).optional(),
  closeDate: z.string().datetime().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  partnerId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  dealStatus: z.enum(["OPEN", "WON", "LOST", "ON_HOLD", "DISQUALIFIED"]).optional(),
  dealType: z.string().optional(),
  lostReason: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

export const addOpportunityLinkSchema = z.object({
  entityType: z.enum(["poc", "proposal", "partner", "customer"]),
  entityId: z.string().min(1),
  linkType: z.string().default("related"),
});

async function resolveProjectId(slug: string, db: OpportunityCenterPrisma) {
  const project = await db.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

export async function createOpportunity(
  input: z.input<typeof createOpportunitySchema>,
  deps: OpportunityCenterDeps = {},
) {
  const db = deps.prisma ?? (realPrisma as unknown as OpportunityCenterPrisma);
  const parsed = createOpportunitySchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug ?? (await resolveDefaultProjectSlug()), db);

  const opp = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('opp_code_seq')`;
    const seq = Number(rows[0].nextval);
    const code = formatDealCode(new Date().getFullYear(), seq);

    const created = await tx.opportunity.create({
      data: {
        projectId,
        title: parsed.title,
        customerId: parsed.customerId,
        partnerId: parsed.partnerId,
        stage: parsed.stage,
        amount: parsed.amount,
        probability: parsed.probability,
        closeDate: parsed.closeDate ? new Date(parsed.closeDate) : undefined,
        nextAction: parsed.nextAction,
        code,
      },
    });

    await tx.opportunityStageEvent.create({
      data: {
        opportunityId: created.id,
        toStage: parsed.stage,
        note: "Opportunity created",
      },
    });

    return created;
  });

  // Best-effort audit log — intentionally outside the transaction.
  await logStateTransition({
    entityType: "opportunity",
    entityId: opp.id,
    fromStatus: null,
    toStatus: parsed.stage,
    actorType: "user",
  });

  return opp;
}

export async function listOpportunities(
  projectSlug?: string,
  deps: OpportunityCenterDeps = {},
) {
  const db = deps.prisma ?? (realPrisma as unknown as OpportunityCenterPrisma);
  const projectId = await resolveProjectId(projectSlug ?? (await resolveDefaultProjectSlug()), db);
  return db.opportunity.findMany({
    where: { projectId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      customer: true,
      partner: true,
      links: true,
      dealRegistration: true,
    },
  });
}

export async function getOpportunityDetail(id: string) {
  return realPrisma.opportunity.findUnique({
    where: { id },
    include: {
      customer: true,
      partner: true,
      distributor: true,
      links: { orderBy: { createdAt: "desc" } },
      stageEvents: { orderBy: { createdAt: "desc" } },
      qualification: { include: { economicBuyer: true, champion: true } },
      dealRegistration: { include: { distributor: true } },
    },
  });
}

export async function updateOpportunity(
  id: string,
  input: z.input<typeof updateOpportunitySchema>,
  deps: OpportunityCenterDeps = {},
) {
  const db = deps.prisma ?? (realPrisma as unknown as OpportunityCenterPrisma);
  const parsed = updateOpportunitySchema.parse(input);
  const existing = await db.opportunity.findUniqueOrThrow({
    where: { id },
    include: { dealRegistration: { select: { regStatus: true } } },
  });

  const data: Record<string, unknown> = {};
  if (parsed.title !== undefined) data.title = parsed.title;
  if (parsed.amount !== undefined) data.amount = parsed.amount;
  if (parsed.probability !== undefined) data.probability = parsed.probability;
  if (parsed.closeDate !== undefined) {
    data.closeDate = parsed.closeDate ? new Date(parsed.closeDate) : null;
  }
  if (parsed.nextAction !== undefined) data.nextAction = parsed.nextAction;
  if (parsed.partnerId !== undefined) data.partnerId = parsed.partnerId;
  if (parsed.customerId !== undefined) data.customerId = parsed.customerId;
  if (parsed.dealStatus !== undefined) data.dealStatus = parsed.dealStatus;
  if (parsed.dealType !== undefined) data.dealType = parsed.dealType;
  if (parsed.lostReason !== undefined) data.lostReason = parsed.lostReason;
  if (parsed.ownerId !== undefined) data.ownerId = parsed.ownerId;

  if (parsed.stage !== undefined && parsed.stage !== existing.stage) {
    const newStage = parsed.stage;

    // Enforce canonical stage ordering: reject illegal skips/regressions
    // (e.g. WON → LEAD) before persisting. The route surfaces this as a 400.
    const order = validateOpportunityStageOrder(existing.stage, newStage);
    if (!order.allowed) {
      throw new Error(`illegal_stage_transition:${order.reason}`);
    }

    // Deal-registration advance gate: for registration-required deal types,
    // block forward entry into the late stages (NEGOTIATION/WON) while the
    // registration is NOT_SUBMITTED or REJECTED. The dealType being set in
    // this same PATCH takes precedence over the stored value.
    const effectiveDealType = parsed.dealType ?? existing.dealType;
    const gate = validateRegistrationGate({
      from: existing.stage,
      to: newStage,
      dealType: effectiveDealType,
      regStatus: existing.dealRegistration?.regStatus ?? null,
    });
    if (!gate.allowed) {
      throw new Error(`registration_gate:${gate.reason}`);
    }

    data.stage = newStage;
    const updated = await db.$transaction(async (tx) => {
      const result = await tx.opportunity.update({ where: { id }, data });
      await tx.opportunityStageEvent.create({
        data: {
          opportunityId: id,
          fromStage: normalizeOpportunityStage(existing.stage),
          toStage: newStage,
          note: "Stage updated",
        },
      });
      return result;
    });

    // Best-effort audit log — intentionally outside the transaction.
    await logStateTransition({
      entityType: "opportunity",
      entityId: id,
      fromStatus: existing.stage,
      toStatus: newStage,
      actorType: "user",
    });

    // S1: unified decision instrumentation (best-effort, outside txn, never throws).
    await recordDecision({
      projectId: existing.projectId,
      domain: "sales",
      actor: "sales",
      actionType: "stage_transition",
      caseRef: "opp:" + id,
      outcome: "approved",
    });

    // If non-stage fields were also edited in this same call, capture them
    // separately so they don't vanish from the decision spine.
    const nonStageFields = Object.fromEntries(
      Object.entries(data).filter(([k]) => k !== "stage"),
    );
    if (Object.keys(nonStageFields).length > 0) {
      await recordDecision({
        projectId: existing.projectId,
        domain: "sales",
        actor: "human",
        actionType: "entity_edit",
        caseRef: caseRefFor("opportunity", id),
        outcome: "corrected",
        humanEdit: nonStageFields,
      });
    }

    return updated;
  }

  const updated = await db.opportunity.update({ where: { id }, data });

  // S1: capture the human field-edit onto the decision spine (best-effort,
  // outside txn, never throws). Pairs with a stage_transition on the same
  // caseRef so { caseRef } returns the full AI-decision + human-edit history.
  await recordDecision({
    projectId: existing.projectId,
    domain: "sales",
    actor: "sales",
    actionType: "entity_edit",
    caseRef: caseRefFor("opportunity", id),
    outcome: "corrected",
    humanEdit: data,
  });

  return updated;
}

export async function advanceOpportunityStage(id: string) {
  const opp = await realPrisma.opportunity.findUniqueOrThrow({
    where: { id },
    include: { dealRegistration: { select: { regStatus: true } } },
  });
  const fromStage = normalizeOpportunityStage(opp.stage);
  const next = nextOpportunityStage(opp.stage);
  if (!next) throw new Error("cannot_advance_stage");

  // Same registration advance gate as updateOpportunity.
  const gate = validateRegistrationGate({
    from: opp.stage,
    to: next,
    dealType: opp.dealType,
    regStatus: opp.dealRegistration?.regStatus ?? null,
  });
  if (!gate.allowed) {
    throw new Error(`registration_gate:${gate.reason}`);
  }

  const updated = await realPrisma.opportunity.update({
    where: { id },
    data: { stage: next },
  });

  await realPrisma.opportunityStageEvent.create({
    data: {
      opportunityId: id,
      fromStage,
      toStage: next,
      note: "단계 진행",
    },
  });

  await logStateTransition({
    entityType: "opportunity",
    entityId: id,
    fromStatus: fromStage,
    toStatus: next,
    actorType: "user",
  });

  // S1: unified decision instrumentation (best-effort, outside txn, never throws).
  await recordDecision({
    projectId: opp.projectId,
    domain: "sales",
    actor: "sales",
    actionType: "stage_transition",
    caseRef: "opp:" + id,
    outcome: "approved",
  });

  return updated;
}

export async function addOpportunityLink(
  opportunityId: string,
  input: z.input<typeof addOpportunityLinkSchema>,
) {
  const parsed = addOpportunityLinkSchema.parse(input);
  return realPrisma.opportunityLink.upsert({
    where: {
      opportunityId_entityType_entityId: {
        opportunityId,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
      },
    },
    update: { linkType: parsed.linkType },
    create: {
      opportunityId,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      linkType: parsed.linkType,
    },
  });
}

export async function removeOpportunityLink(linkId: string) {
  return realPrisma.opportunityLink.delete({ where: { id: linkId } });
}

export async function archiveOpportunity(
  id: string,
  deps: OpportunityCenterDeps = {},
) {
  const db = deps.prisma ?? (realPrisma as unknown as OpportunityCenterPrisma);
  const existing = await db.opportunity.findUniqueOrThrow({ where: { id } });
  const updated = await db.opportunity.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  // Best-effort decision spine capture — outside txn, never throws.
  await recordDecision({
    projectId: existing.projectId,
    domain: "sales",
    actor: "human",
    actionType: "entity_archive",
    caseRef: caseRefFor("opportunity", id),
    outcome: "approved",
  });
  return updated;
}

export type EnrichedOpportunityLink = {
  id: string;
  entityType: string;
  entityId: string;
  linkType: string;
  label: string;
  href: string | null;
};

export async function enrichOpportunityLinks(
  links: Array<{ id: string; entityType: string; entityId: string; linkType: string }>,
): Promise<EnrichedOpportunityLink[]> {
  return Promise.all(
    links.map(async (link) => {
      let label = link.entityId;
      let href: string | null = null;

      if (link.entityType === "poc") {
        const row = await realPrisma.pocProject.findUnique({
          where: { id: link.entityId },
          select: { title: true },
        });
        if (row) {
          label = row.title;
          href = `/poc/${link.entityId}`;
        }
      } else if (link.entityType === "proposal") {
        const row = await realPrisma.generatedDocument.findUnique({
          where: { id: link.entityId },
          select: { title: true },
        });
        if (row) {
          label = row.title;
          href = `/proposals/${link.entityId}`;
        }
      } else if (link.entityType === "partner") {
        const row = await realPrisma.partner.findUnique({
          where: { id: link.entityId },
          select: { name: true },
        });
        if (row) {
          label = row.name;
          href = `/partners/${link.entityId}`;
        }
      } else if (link.entityType === "customer") {
        const row = await realPrisma.customer.findUnique({
          where: { id: link.entityId },
          select: { name: true },
        });
        if (row) {
          label = row.name;
          href = `/customers/${link.entityId}`;
        }
      }

      return { ...link, label, href };
    }),
  );
}

export async function getOpportunityPipelineSummary(projectSlug?: string) {
  const rows = await listOpportunities(projectSlug);
  const byStage: Record<string, number> = {};
  for (const stage of CANONICAL_STAGES) byStage[stage] = 0;
  for (const row of rows) {
    const canonical = normalizeOpportunityStage(row.stage);
    byStage[canonical] = (byStage[canonical] ?? 0) + 1;
  }
  return { total: rows.length, byStage };
}

/**
 * List quotes for one opportunity (newest first). Used by the deal workspace
 * ④ 선정·입찰 work panel.
 */
export async function listQuotesByOpportunity(opportunityId: string) {
  return realPrisma.quote.findMany({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
  });
}
