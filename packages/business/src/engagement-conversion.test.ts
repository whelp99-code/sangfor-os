import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("Opportunity → Engagement conversion", () => {
  it("converts idempotently and absorbs proposals/poc/quote/meetings", async () => {
    const { prisma } = await import("@sangfor/db");
    const { generateProposal } = await import("./proposal-generator");
    const { convertOpportunityToProject } = await import("./engagement-center");

    const unique = Date.now();
    const tag = `IT_ENG_${unique}`;
    const project = await prisma.project.findFirstOrThrow();
    const customer = await prisma.customer.create({ data: { projectId: project.id, name: `${tag} 고객` } });
    const opp = await prisma.opportunity.create({
      data: { projectId: project.id, customerId: customer.id, title: `${tag} 기회`, stage: "POC", amount: "100" },
    });
    const poc = await prisma.pocProject.create({
      data: { projectId: project.id, customerId: customer.id, title: `${tag} POC`, opportunityId: opp.id },
    });
    const proposal = await generateProposal({
      projectSlug: project.slug,
      title: `${tag} 제안서`,
      templateKey: "standard-proposal",
      customerId: customer.id,
      opportunityId: opp.id,
      variables: {},
    });
    const quote = await prisma.quote.create({
      data: {
        opportunityId: opp.id,
        companyId: "it-co",
        status: "sent",
        version: 2,
        totalRevenue: "480",
        totalCost: "300",
        marginPct: "37.5",
        createdBy: "integration-test",
      },
    });
    await prisma.meetingNote.create({
      data: { opportunityId: opp.id, customerId: customer.id, title: `${tag} 미팅`, bodyMarkdown: "POC 계획 고객사 확정" },
    });

    try {
      const first = await convertOpportunityToProject({ opportunityId: opp.id });
      const second = await convertOpportunityToProject({ opportunityId: opp.id });

      // Idempotent: exactly one engagement, same id, second call is a no-op.
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.engagement.id).toBe(first.engagement.id);
      expect(await prisma.engagement.count({ where: { opportunityId: opp.id } })).toBe(1);

      // Absorbed exactly the seeded artifacts.
      expect(first.absorbed).toEqual({ proposals: 1, poc: 1, quotes: 1, meetings: 1 });

      // Amount comes from the latest non-draft quote (480), not opportunity.amount (100).
      expect(Number(first.engagement.amount)).toBe(480);
      expect(first.engagement.status).toBe("pre_engagement");

      // FK re-parent actually happened.
      const absorbedProposal = await prisma.generatedDocument.findUnique({ where: { id: proposal!.id } });
      expect(absorbedProposal?.engagementId).toBe(first.engagement.id);
    } finally {
      // Cleanup (reverse FK order).
      await prisma.meetingNote.deleteMany({ where: { opportunityId: opp.id } });
      await prisma.documentVersion.deleteMany({ where: { generatedDocumentId: proposal!.id } });
      await prisma.generatedDocument.deleteMany({ where: { id: proposal!.id } });
      await prisma.quote.deleteMany({ where: { id: quote.id } });
      await prisma.pocProject.deleteMany({ where: { id: poc.id } });
      await prisma.opportunityStageEvent.deleteMany({ where: { opportunityId: opp.id } });
      await prisma.stateTransitionLog.deleteMany({ where: { entityId: opp.id } });
      await prisma.engagement.deleteMany({ where: { opportunityId: opp.id } });
      await prisma.opportunity.deleteMany({ where: { id: opp.id } });
      await prisma.customer.deleteMany({ where: { id: customer.id } });
    }
  });

  it("rejects conversion without a linked POC unless forced", async () => {
    const { prisma } = await import("@sangfor/db");
    const { convertOpportunityToProject } = await import("./engagement-center");

    const unique = Date.now();
    const tag = `IT_ENG_NOPOC_${unique}`;
    const project = await prisma.project.findFirstOrThrow();
    const opp = await prisma.opportunity.create({
      data: { projectId: project.id, title: `${tag} 기회`, stage: "POC" },
    });

    try {
      await expect(convertOpportunityToProject({ opportunityId: opp.id })).rejects.toThrow(/POC/);
      const forced = await convertOpportunityToProject({ opportunityId: opp.id, force: true });
      expect(forced.created).toBe(true);
    } finally {
      await prisma.opportunityStageEvent.deleteMany({ where: { opportunityId: opp.id } });
      await prisma.stateTransitionLog.deleteMany({ where: { entityId: opp.id } });
      await prisma.engagement.deleteMany({ where: { opportunityId: opp.id } });
      await prisma.opportunity.deleteMany({ where: { id: opp.id } });
    }
  });
});
