import { prisma } from "@sangfor/db";
import { z } from "zod";

import { logStateTransition } from "./audit";
import {
  CANONICAL_STAGES,
  normalizeOpportunityStage,
  nextOpportunityStage,
} from "./opportunity-stage";

const stageInput = z
  .enum([
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
  stage: stageInput.default("lead"),
  amount: z.number().optional(),
  probability: z.number().min(0).max(100).default(20),
  closeDate: z.string().datetime().optional(),
  nextAction: z.string().optional(),
});

export const updateOpportunitySchema = z.object({
  title: z.string().min(2).optional(),
  stage: stageInput.optional(),
  amount: z.number().optional(),
  probability: z.number().min(0).max(100).optional(),
  closeDate: z.string().datetime().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  partnerId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
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

  const opp = await prisma.opportunity.create({
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
    },
  });

  await prisma.opportunityStageEvent.create({
    data: {
      opportunityId: opp.id,
      toStage: parsed.stage,
      note: "Opportunity created",
    },
  });

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
    },
  });
}

export async function getOpportunityDetail(id: string) {
  return prisma.opportunity.findUnique({
    where: { id },
    include: {
      customer: true,
      partner: true,
      links: { orderBy: { createdAt: "desc" } },
      stageEvents: { orderBy: { createdAt: "desc" } },
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

  if (parsed.stage !== undefined && parsed.stage !== existing.stage) {
    data.stage = parsed.stage;
    await prisma.opportunityStageEvent.create({
      data: {
        opportunityId: id,
        fromStage: normalizeOpportunityStage(existing.stage),
        toStage: parsed.stage,
        note: "Stage updated",
      },
    });
    await logStateTransition({
      entityType: "opportunity",
      entityId: id,
      fromStatus: existing.stage,
      toStatus: parsed.stage,
      actorType: "user",
    });
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
