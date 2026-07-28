import type { AuthContext } from "@sangfor/auth";
import type { Prisma } from "@sangfor/db";

import {
  executeOpportunityConversion,
  opportunityConversionCommandSchema,
  withScopedOpportunityRead,
  type OpportunityConversionCommand,
} from "./opportunity-center";

export const convertOpportunityToProjectSchema = opportunityConversionCommandSchema;
export type AbsorbedCounts = {
  proposals: number;
  poc: number;
  quotes: number;
  meetings: number;
};

async function currentAbsorbed(
  tx: Prisma.TransactionClient,
  engagementId: string,
): Promise<AbsorbedCounts> {
  const [proposals, poc, meetings, engagement] = await Promise.all([
    tx.generatedDocument.count({ where: { engagementId } }),
    tx.pocProject.count({ where: { engagementId } }),
    tx.meetingNote.count({ where: { engagementId } }),
    tx.engagement.findUnique({
      where: { id: engagementId },
      select: { amountQuoteId: true },
    }),
  ]);
  return { proposals, poc, meetings, quotes: engagement?.amountQuoteId ? 1 : 0 };
}

/**
 * Public compatibility name for U043's canonical scoped opportunity conversion. The caller can
 * supply only the opportunity snapshot, expected version and bounded idempotency input.
 */
export async function convertOpportunityToProject(
  ctx: AuthContext,
  command: OpportunityConversionCommand,
) {
  return executeOpportunityConversion(ctx, command, async (tx, opportunity) => {
    const existing = await tx.engagement.findUnique({
      where: { opportunityId: opportunity.id },
    });
    if (existing) {
      return {
        engagement: existing,
        created: false,
        absorbed: await currentAbsorbed(tx, existing.id),
      };
    }

    const quote = await tx.quote.findFirst({
      where: { opportunityId: opportunity.id, status: { not: "draft" } },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    });
    const engagement = await tx.engagement.create({
      data: {
        opportunityId: opportunity.id,
        projectId: opportunity.projectId,
        customerId: opportunity.customerId,
        name: opportunity.title,
        status: opportunity.stage === "WON" ? "planned" : "pre_engagement",
        amount: quote?.totalRevenue ?? null,
        amountQuoteId: quote?.id ?? null,
        convertedAt: new Date(),
        convertedFromStage: opportunity.stage,
        summaryMarkdown: `전환: ${opportunity.title} (단계 ${opportunity.stage}).`,
      },
    });

    const proposalLinks = await tx.opportunityLink.findMany({
      where: { opportunityId: opportunity.id, entityType: "proposal" },
      select: { entityId: true },
    });
    const documents = await tx.generatedDocument.findMany({
      where: {
        OR: [
          { opportunityId: opportunity.id },
          { id: { in: proposalLinks.map((link) => link.entityId) } },
        ],
      },
      select: { id: true },
    });
    const proposals = documents.length > 0
      ? (await tx.generatedDocument.updateMany({
          where: { id: { in: documents.map((document) => document.id) } },
          data: { engagementId: engagement.id },
        })).count
      : 0;

    const pocLinks = await tx.opportunityLink.findMany({
      where: { opportunityId: opportunity.id, entityType: "poc" },
      select: { entityId: true },
    });
    const pocIds = new Set(pocLinks.map((link) => link.entityId));
    const directPoc = await tx.pocProject.findMany({
      where: { opportunityId: opportunity.id, projectId: opportunity.projectId },
      select: { id: true },
    });
    directPoc.forEach((poc) => pocIds.add(poc.id));
    const poc = pocIds.size > 0
      ? (await tx.pocProject.updateMany({
          where: {
            id: { in: [...pocIds] },
            projectId: opportunity.projectId,
          },
          data: { engagementId: engagement.id },
        })).count
      : 0;

    const meetings = (await tx.meetingNote.updateMany({
      where: {
        opportunityId: opportunity.id,
        engagementId: null,
        status: "confirmed",
      },
      data: { engagementId: engagement.id },
    })).count;

    return {
      engagement,
      created: true,
      absorbed: { proposals, poc, quotes: quote ? 1 : 0, meetings },
    };
  });
}

export async function getEngagementDetail(ctx: AuthContext, id: string) {
  return withScopedOpportunityRead(ctx, async (tx) => {
    const engagement = await tx.engagement.findFirst({
      where: {
        id,
        opportunity: { projectId: ctx.projectId, archivedAt: null },
      },
      include: {
        opportunity: { include: { customer: true } },
        checklistItems: true,
        generatedDocuments: {
          include: {
            template: true,
            versions: { orderBy: { version: "desc" }, take: 1 },
          },
        },
        meetingNotes: { orderBy: { occurredAt: "desc" } },
      },
    });
    if (!engagement) return null;
    const pocProjects = await tx.pocProject.findMany({
      where: { engagementId: id, projectId: ctx.projectId },
    });
    return { ...engagement, pocProjects };
  });
}

export async function getEngagementByOpportunity(ctx: AuthContext, opportunityId: string) {
  return withScopedOpportunityRead(ctx, async (tx) => {
    const engagement = await tx.engagement.findFirst({
      where: {
        opportunityId,
        opportunity: { projectId: ctx.projectId, archivedAt: null },
      },
      include: {
        opportunity: { include: { customer: true } },
        checklistItems: true,
        generatedDocuments: {
          include: {
            template: true,
            versions: { orderBy: { version: "desc" }, take: 1 },
          },
        },
        meetingNotes: { orderBy: { occurredAt: "desc" } },
      },
    });
    if (!engagement) return null;
    const pocProjects = await tx.pocProject.findMany({
      where: { engagementId: engagement.id, projectId: ctx.projectId },
    });
    return { ...engagement, pocProjects };
  });
}

export async function listEngagements(ctx: AuthContext) {
  return withScopedOpportunityRead(ctx, (tx) => tx.engagement.findMany({
    where: { opportunity: { projectId: ctx.projectId, archivedAt: null } },
    orderBy: { convertedAt: "desc" },
    include: {
      opportunity: {
        select: {
          title: true,
          stage: true,
          customer: { select: { name: true } },
        },
      },
      _count: {
        select: {
          generatedDocuments: true,
          meetingNotes: true,
          checklistItems: true,
        },
      },
    },
  }));
}
