/**
 * Opportunity(영업기회) → Engagement(프로젝트) conversion.
 *
 * Trigger (user-defined): a customer meeting confirmed the POC plan. So conversion
 * is gated on a linked POC (evidence of "POC 계획 고객사 확정"), not on stage===WON.
 * The created Engagement absorbs the opportunity's proposals, quote-derived amount,
 * meeting notes, and (opt-in) POC, while leaving the originals intact (re-parent via
 * nullable FK, never delete the audit OpportunityLink rows).
 *
 * Idempotency = DB unique (Engagement.opportunityId @unique) + a single
 * prisma.$transaction. Re-converting returns the existing engagement (no duplicate).
 */
import { prisma } from "@sangfor/db";
import { z } from "zod";

const CONVERTIBLE_STAGES = new Set<string>(["PROPOSAL", "POC", "NEGOTIATION", "WON"]);

export const convertOpportunityToProjectSchema = z.object({
  opportunityId: z.string(),
  name: z.string().optional(),
  // Bypass the convertible-stage and POC-evidence gates (e.g. ops override).
  force: z.boolean().default(false),
  absorb: z
    .object({
      proposals: z.boolean().default(true),
      poc: z.boolean().default(true),
      quotes: z.boolean().default(true),
      meetings: z.boolean().default(true),
      // P7 #4: by default only auto-attach trusted (status="confirmed") meetings.
      // Low-confidence auto-promoted notes (status="suggested") need human review;
      // set true to absorb them too.
      suggestedMeetings: z.boolean().default(false),
    })
    .default({}),
});

export type AbsorbedCounts = { proposals: number; poc: number; quotes: number; meetings: number };

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002",
  );
}

async function currentAbsorbed(engagementId: string): Promise<AbsorbedCounts> {
  const [proposals, poc, meetings, quotes] = await Promise.all([
    prisma.generatedDocument.count({ where: { engagementId } }),
    prisma.pocProject.count({ where: { engagementId } }),
    prisma.meetingNote.count({ where: { engagementId } }),
    prisma.engagement
      .findUnique({ where: { id: engagementId }, select: { amountQuoteId: true } })
      .then((e) => (e?.amountQuoteId ? 1 : 0)),
  ]);
  return { proposals, poc, quotes, meetings };
}

export async function convertOpportunityToProject(
  input: z.input<typeof convertOpportunityToProjectSchema>,
): Promise<{ engagement: NonNullable<Awaited<ReturnType<typeof getEngagementDetail>>>; created: boolean; absorbed: AbsorbedCounts }> {
  const parsed = convertOpportunityToProjectSchema.parse(input);

  const opp = await prisma.opportunity.findUnique({ where: { id: parsed.opportunityId } });
  if (!opp) throw new Error(`Opportunity not found: ${parsed.opportunityId}`);

  // Gate 1: convertible stage (skippable with force).
  if (!parsed.force && !CONVERTIBLE_STAGES.has(opp.stage)) {
    throw new Error(
      `Opportunity stage ${opp.stage} is not convertible. Need PROPOSAL/POC/NEGOTIATION/WON, or pass force=true.`,
    );
  }

  // Gate 2: POC-confirmed evidence (the conversion trigger). Skippable with force.
  if (!parsed.force) {
    const pocLink = await prisma.opportunityLink.findFirst({
      where: { opportunityId: opp.id, entityType: "poc" },
    });
    const pocFk = await prisma.pocProject.findFirst({ where: { opportunityId: opp.id } });
    if (!pocLink && !pocFk) {
      throw new Error(
        "No confirmed POC is linked to this opportunity. Confirm the POC plan with the customer (link a POC) or pass force=true.",
      );
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Idempotent guard inside the transaction.
      const already = await tx.engagement.findUnique({ where: { opportunityId: opp.id } });
      if (already) return { engagementId: already.id, created: false as const };

      // Amount = latest non-draft quote's total revenue (no row-summing — avoids double count).
      const quote = parsed.absorb.quotes
        ? await tx.quote.findFirst({
            where: { opportunityId: opp.id, status: { not: "draft" } },
            orderBy: [{ version: "desc" }, { createdAt: "desc" }],
          })
        : null;

      const engagement = await tx.engagement.create({
        data: {
          opportunityId: opp.id,
          projectId: opp.projectId,
          customerId: opp.customerId,
          name: parsed.name ?? opp.title,
          status: opp.stage === "WON" ? "planned" : "pre_engagement",
          amount: quote?.totalRevenue ?? null,
          amountQuoteId: quote?.id ?? null,
          convertedAt: new Date(),
          convertedFromStage: opp.stage,
          summaryMarkdown: `전환: ${opp.title} (단계 ${opp.stage}).`,
        },
      });

      // Absorb proposals: FK opportunityId UNION OpportunityLink('proposal').
      let proposals = 0;
      if (parsed.absorb.proposals) {
        const links = await tx.opportunityLink.findMany({
          where: { opportunityId: opp.id, entityType: "proposal" },
          select: { entityId: true },
        });
        const docs = await tx.generatedDocument.findMany({
          where: { OR: [{ opportunityId: opp.id }, { id: { in: links.map((l) => l.entityId) } }] },
          select: { id: true },
        });
        if (docs.length) {
          proposals = (
            await tx.generatedDocument.updateMany({
              where: { id: { in: docs.map((d) => d.id) } },
              data: { engagementId: engagement.id },
            })
          ).count;
        }
      }

      // Absorb POC (opt-in): FK opportunityId UNION OpportunityLink('poc').
      let poc = 0;
      if (parsed.absorb.poc) {
        const links = await tx.opportunityLink.findMany({
          where: { opportunityId: opp.id, entityType: "poc" },
          select: { entityId: true },
        });
        const ids = new Set(links.map((l) => l.entityId));
        const byFk = await tx.pocProject.findMany({ where: { opportunityId: opp.id }, select: { id: true } });
        byFk.forEach((p) => ids.add(p.id));
        if (ids.size) {
          poc = (
            await tx.pocProject.updateMany({
              where: { id: { in: [...ids] } },
              data: { engagementId: engagement.id },
            })
          ).count;
        }
      }

      // Absorb meeting notes scoped to this opportunity.
      let meetings = 0;
      if (parsed.absorb.meetings) {
        const allowedStatuses = parsed.absorb.suggestedMeetings
          ? ["confirmed", "suggested"]
          : ["confirmed"];
        meetings = (
          await tx.meetingNote.updateMany({
            where: { opportunityId: opp.id, engagementId: null, status: { in: allowedStatuses } },
            data: { engagementId: engagement.id },
          })
        ).count;
      }

      // Audit — written with the tx client (atomic with the conversion).
      await tx.opportunityStageEvent.create({
        data: { opportunityId: opp.id, fromStage: opp.stage, toStage: opp.stage, note: "converted_to_project" },
      });
      await tx.stateTransitionLog.create({
        data: {
          entityType: "opportunity",
          entityId: opp.id,
          fromStatus: opp.stage,
          toStatus: opp.stage,
          actorType: "user",
          metadata: { action: "converted_to_project", engagementId: engagement.id },
        },
      });

      return {
        engagementId: engagement.id,
        created: true as const,
        absorbed: { proposals, poc, quotes: quote ? 1 : 0, meetings },
      };
    });

    const engagement = await getEngagementDetail(result.engagementId);
    if (!engagement) throw new Error("Engagement vanished after conversion");
    const absorbed = result.created ? result.absorbed : await currentAbsorbed(result.engagementId);
    return { engagement, created: result.created, absorbed };
  } catch (error) {
    // Lost a create race against a concurrent convert — return the winner's row.
    if (isUniqueViolation(error)) {
      const existing = await prisma.engagement.findUnique({ where: { opportunityId: parsed.opportunityId } });
      if (existing) {
        const engagement = await getEngagementDetail(existing.id);
        if (engagement) return { engagement, created: false, absorbed: await currentAbsorbed(existing.id) };
      }
    }
    throw error;
  }
}

export async function getEngagementDetail(id: string) {
  const engagement = await prisma.engagement.findUnique({
    where: { id },
    include: {
      opportunity: { include: { customer: true } },
      checklistItems: true,
      generatedDocuments: { include: { template: true, versions: { orderBy: { version: "desc" }, take: 1 } } },
      meetingNotes: { orderBy: { occurredAt: "desc" } },
    },
  });
  if (!engagement) return null;
  // POC links via scalar engagementId (opt-in, no relation), so fetch separately.
  const pocProjects = await prisma.pocProject.findMany({ where: { engagementId: id } });
  return { ...engagement, pocProjects };
}

export async function getEngagementByOpportunity(opportunityId: string) {
  const engagement = await prisma.engagement.findUnique({ where: { opportunityId }, select: { id: true } });
  return engagement ? getEngagementDetail(engagement.id) : null;
}

export async function listEngagements() {
  return prisma.engagement.findMany({
    orderBy: { convertedAt: "desc" },
    include: {
      opportunity: { select: { title: true, stage: true, customer: { select: { name: true } } } },
      _count: { select: { generatedDocuments: true, meetingNotes: true, checklistItems: true } },
    },
  });
}
