import { prisma } from "@sangfor/db";
import { z } from "zod";

import { logStateTransition } from "./audit";
import { formatDealCode } from "./deal-code";
import {
  CANONICAL_STAGES,
  normalizeOpportunityStage,
  nextOpportunityStage,
} from "./opportunity-stage";

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
  projectSlug: z.string().default("demo-project"),
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

async function resolveProjectId(slug: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

export async function createOpportunity(input: z.input<typeof createOpportunitySchema>) {
  const parsed = createOpportunitySchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug);

  const opp = await prisma.$transaction(async (tx) => {
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

export async function listOpportunities(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  return prisma.opportunity.findMany({
    where: { projectId },
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
  return prisma.opportunity.findUnique({
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
) {
  const parsed = updateOpportunitySchema.parse(input);
  const existing = await prisma.opportunity.findUniqueOrThrow({ where: { id } });

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
    data.stage = newStage;
    const updated = await prisma.$transaction(async (tx) => {
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

    return updated;
  }

  return prisma.opportunity.update({ where: { id }, data });
}

export async function advanceOpportunityStage(id: string) {
  const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
  const fromStage = normalizeOpportunityStage(opp.stage);
  const next = nextOpportunityStage(opp.stage);
  if (!next) throw new Error("cannot_advance_stage");

  const updated = await prisma.opportunity.update({
    where: { id },
    data: { stage: next },
  });

  await prisma.opportunityStageEvent.create({
    data: {
      opportunityId: id,
      fromStage,
      toStage: next,
      note: "Stage advanced",
    },
  });

  await logStateTransition({
    entityType: "opportunity",
    entityId: id,
    fromStatus: fromStage,
    toStatus: next,
    actorType: "user",
  });

  return updated;
}

export async function addOpportunityLink(
  opportunityId: string,
  input: z.input<typeof addOpportunityLinkSchema>,
) {
  const parsed = addOpportunityLinkSchema.parse(input);
  return prisma.opportunityLink.upsert({
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
  return prisma.opportunityLink.delete({ where: { id: linkId } });
}

export async function archiveOpportunity(id: string) {
  return prisma.opportunity.delete({ where: { id } });
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
        const row = await prisma.pocProject.findUnique({
          where: { id: link.entityId },
          select: { title: true },
        });
        if (row) {
          label = row.title;
          href = `/poc/${link.entityId}`;
        }
      } else if (link.entityType === "proposal") {
        const row = await prisma.generatedDocument.findUnique({
          where: { id: link.entityId },
          select: { title: true },
        });
        if (row) {
          label = row.title;
          href = `/proposals/${link.entityId}`;
        }
      } else if (link.entityType === "partner") {
        const row = await prisma.partner.findUnique({
          where: { id: link.entityId },
          select: { name: true },
        });
        if (row) {
          label = row.name;
          href = `/partners/${link.entityId}`;
        }
      } else if (link.entityType === "customer") {
        const row = await prisma.customer.findUnique({
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

export async function getOpportunityPipelineSummary(projectSlug = "demo-project") {
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
  return prisma.quote.findMany({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
  });
}
