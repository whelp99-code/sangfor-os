/**
 * One-time, idempotent backfills that close the legacy gap where proposals/POCs
 * were linked to an opportunity only via OpportunityLink (because generateProposal
 * dropped opportunityId before P2). After this, GeneratedDocument.opportunityId /
 * PocProject.opportunityId become the canonical absorb source, and the
 * OpportunityLink rows remain as audit trail.
 *
 * Safe to run repeatedly: only fills rows where the FK is currently null.
 */
import { prisma } from "@sangfor/db";

async function backfillFromLinks(
  entityType: "proposal" | "poc",
): Promise<{ entityType: string; linkCount: number; updated: number; fkCount: number }> {
  const links = await prisma.opportunityLink.findMany({ where: { entityType } });

  let updated = 0;
  for (const link of links) {
    if (entityType === "proposal") {
      const res = await prisma.generatedDocument.updateMany({
        where: { id: link.entityId, opportunityId: null },
        data: { opportunityId: link.opportunityId },
      });
      updated += res.count;
    } else {
      const res = await prisma.pocProject.updateMany({
        where: { id: link.entityId, opportunityId: null },
        data: { opportunityId: link.opportunityId },
      });
      updated += res.count;
    }
  }

  const fkCount =
    entityType === "proposal"
      ? await prisma.generatedDocument.count({ where: { opportunityId: { not: null } } })
      : await prisma.pocProject.count({ where: { opportunityId: { not: null } } });

  return { entityType, linkCount: links.length, updated, fkCount };
}

export async function backfillEngagementSourceLinks() {
  const proposals = await backfillFromLinks("proposal");
  const pocs = await backfillFromLinks("poc");
  return { proposals, pocs };
}
