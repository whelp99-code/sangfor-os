import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("Phase 12 mail candidate connection", () => {
  it("connects an approved mail candidate to customer, contact, opportunity, proposal, and evidence links", async () => {
    const { prisma } = await import("@sangfor/db");
    const { approveAndConnectMailCandidate } = await import("./mail-candidate-connections");
    const { resolveProjectId } = await import("./mail-policy-memory");

    const projectId = await resolveProjectId("demo-project");
    const unique = Date.now();
    const candidate = await prisma.mailDerivedCandidate.create({
      data: {
        candidateType: "opportunity",
        title: `Opportunity: Acme Renewal ${unique}`,
        summary: "Acme asked for a renewal proposal and commercial follow-up.",
        sourceTitle: "Acme renewal mail",
        sourceSender: `Kim Operator <kim.${unique}@acme.example.com>`,
        confidence: 91,
        status: "proposed",
        metadata: {
          sourceMessageIds: [`msg-${unique}`],
          participantDomains: ["acme.example.com"],
          mailIntelligence: {
            evidenceItems: ["renewal proposal requested"],
            nextActions: [{ recommendedAction: "prepare proposal" }],
          },
          aiRevalidation: { decision: "approve_candidate", missingFields: [], riskFlags: [] },
        },
      },
    });

    const result = await approveAndConnectMailCandidate({
      candidateId: candidate.id,
      customer: { mode: "create", name: `Acme Renewal ${unique}`, domain: "acme.example.com" },
      contact: { mode: "create", name: "Kim Operator", email: `kim.${unique}@acme.example.com` },
      opportunity: { mode: "create", title: `Acme Renewal ${unique}` },
      proposal: { mode: "create", title: `Proposal — Acme Renewal ${unique}`, templateKey: "standard-proposal" },
    });

    expect(result.candidate.status).toBe("converted");
    expect(result.customer.id).toBeTruthy();
    expect(result.contact?.id).toBeTruthy();
    expect(result.opportunity.id).toBeTruthy();
    expect(result.proposal?.id).toBeTruthy();

    const links = await prisma.mailEvidenceLink.findMany({
      where: { mailDerivedCandidateId: candidate.id },
      orderBy: { targetEntityType: "asc" },
    });
    expect(links.map((link) => link.targetEntityType)).toEqual(
      expect.arrayContaining(["customer", "contact", "opportunity", "proposal"]),
    );

    const opportunityLinks = await prisma.opportunityLink.findMany({
      where: { opportunityId: result.opportunity.id, entityType: "proposal", entityId: result.proposal!.id },
    });
    expect(opportunityLinks).toHaveLength(1);

    const updated = await prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(updated.createdEntityType).toBe("opportunity");
    expect(updated.createdEntityId).toBe(result.opportunity.id);
    expect(updated.metadata).toMatchObject({
      connectionResult: {
        customerId: result.customer.id,
        opportunityId: result.opportunity.id,
        proposalId: result.proposal!.id,
      },
    });

    expect(projectId).toBeTruthy();
  }, 20_000);

  it("does not create a customer when an existing contact belongs to another customer", async () => {
    const { prisma } = await import("@sangfor/db");
    const { approveAndConnectMailCandidate } = await import("./mail-candidate-connections");
    const { createContact, createCustomer } = await import("./customer-partner");

    const unique = Date.now();
    const otherCustomer = await createCustomer({
      projectSlug: "demo-project",
      name: `Other Customer ${unique}`,
      domain: `other-${unique}.example.com`,
    });
    const otherContact = await createContact({
      customerId: otherCustomer.id,
      name: "Other Contact",
      email: `other.${unique}@example.com`,
    });
    const candidate = await prisma.mailDerivedCandidate.create({
      data: {
        candidateType: "opportunity",
        title: `Opportunity: Partial Write Guard ${unique}`,
        summary: "Candidate should fail before creating a new customer.",
        sourceTitle: "Partial write guard mail",
        sourceSender: `Buyer <buyer.${unique}@guard.example.com>`,
        confidence: 91,
        status: "proposed",
        metadata: {
          participantDomains: ["guard.example.com"],
          aiRevalidation: { decision: "approve_candidate", missingFields: [], riskFlags: [] },
        },
      },
    });

    await expect(
      approveAndConnectMailCandidate({
        candidateId: candidate.id,
        customer: { mode: "create", name: `New Guard Customer ${unique}`, domain: `guard-${unique}.example.com` },
        contact: { mode: "existing", id: otherContact.id },
        opportunity: { mode: "create", title: `Guard Opportunity ${unique}` },
        proposal: { mode: "skip" },
      }),
    ).rejects.toThrow("contact_customer_mismatch");

    await expect(
      prisma.customer.findFirstOrThrow({ where: { name: `New Guard Customer ${unique}` } }),
    ).rejects.toThrow();
  }, 20_000);
});
