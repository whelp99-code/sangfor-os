import { describe, expect, it } from "vitest";

import {
  approveAndConnectMailCandidateSchema,
  buildMailCandidateConnectionDefaults,
  buildMailEvidenceLinkInputs,
  getConnectionResultIds,
  summarizeMailEvidenceCandidate,
} from "./mail-candidate-connections";

describe("mail candidate connection defaults", () => {
  it("uses sender email metadata for legacy mail fallback customer defaults", () => {
    const defaults = buildMailCandidateConnectionDefaults({
      id: "candidate-real-mail",
      candidateType: "opportunity",
      title: "Opportunity: Mail: Re: Quote for 500 units - Q3 pricing",
      summary: "Email: john@acmecorp.com Please send updated quote with Q3 discount. Need by EOD.",
      sourceSender: "John Smith",
      sourceTitle: "Mail: Re: Quote for 500 units - Q3 pricing",
      confidence: 69,
      metadata: {
        email: "john@acmecorp.com",
        legacyKnowledgeFallback: true,
        aiRevalidation: {
          decision: "needs_human_review",
          missingFields: ["customer/partner confirmation"],
          riskFlags: ["low_confidence"],
        },
      },
    });

    expect(defaults.customer.name).toBe("Acmecorp");
    expect(defaults.customer.domain).toBe("acmecorp.com");
    expect(defaults.contact).toEqual({
      name: "John Smith",
      email: "john@acmecorp.com",
      role: "Mail requester",
    });
  });

  it("derives customer, contact, opportunity, proposal, and evidence defaults from a mail candidate", () => {
    const defaults = buildMailCandidateConnectionDefaults({
      id: "candidate-1",
      candidateType: "opportunity",
      title: "Opportunity: Acme HCI Renewal",
      summary: "Acme requested Sangfor HCI renewal pricing and a proposal by next week.",
      sourceSender: "Kim Operator <kim@acme.example.com>",
      sourceTitle: "[Acme] HCI renewal quotation request",
      confidence: 88,
      metadata: {
        threadKey: "thread-acme-renewal",
        sourceMessageIds: ["m-1", "m-2"],
        participantDomains: ["acme.example.com"],
        mailIntelligence: {
          evidenceItems: ["Requested renewal pricing", "Needs proposal by next week"],
          nextActions: [
            { recommendedAction: "Prepare proposal draft", evidence: "proposal by next week" },
          ],
        },
        aiRevalidation: {
          decision: "approve_candidate",
          missingFields: ["budget"],
          riskFlags: ["discount unknown"],
        },
      },
    });

    expect(defaults.customer.name).toBe("Acme HCI Renewal");
    expect(defaults.customer.domain).toBe("acme.example.com");
    expect(defaults.contact).toEqual({
      name: "Kim Operator",
      email: "kim@acme.example.com",
      role: "Mail requester",
    });
    expect(defaults.opportunity.title).toBe("Acme HCI Renewal");
    expect(defaults.opportunity.nextAction).toContain("Acme requested Sangfor HCI renewal pricing");
    expect(defaults.proposal.title).toBe("Proposal — Acme HCI Renewal");
    expect(defaults.proposal.templateKey).toBe("standard-proposal");
    expect(defaults.evidence.summary).toContain("Acme requested Sangfor HCI renewal pricing");
    expect(defaults.evidence.items).toEqual([
      "Requested renewal pricing",
      "Needs proposal by next week",
    ]);
    expect(defaults.evidence.nextActions).toEqual(["Prepare proposal draft"]);
    expect(defaults.evidence.sourceMessageIds).toEqual(["m-1", "m-2"]);
    expect(defaults.evidence.missingFields).toEqual(["budget"]);
    expect(defaults.evidence.riskFlags).toEqual(["discount unknown"]);
  });
});

describe("approve and connect request validation", () => {
  it("requires an opportunity when proposal draft creation is requested", () => {
    const result = approveAndConnectMailCandidateSchema.safeParse({
      candidateId: "candidate-1",
      customer: { mode: "create", name: "Acme", domain: "acme.example.com" },
      contact: { mode: "skip" },
      opportunity: { mode: "skip" },
      proposal: { mode: "create", title: "Proposal — Acme", templateKey: "standard-proposal" },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        "proposal_requires_opportunity",
      );
    }
  });
});

describe("mail evidence link inputs", () => {
  it("extracts connected entity ids from a converted candidate metadata payload", () => {
    expect(
      getConnectionResultIds({
        metadata: {
          connectionResult: {
            customerId: "customer-1",
            contactId: "contact-1",
            opportunityId: "opportunity-1",
            proposalId: "proposal-1",
          },
        },
      }),
    ).toEqual({
      customerId: "customer-1",
      contactId: "contact-1",
      opportunityId: "opportunity-1",
      proposalId: "proposal-1",
    });
  });

  it("summarizes linked candidate evidence for downstream detail pages", () => {
    expect(
      summarizeMailEvidenceCandidate({
        id: "candidate-1",
        candidateType: "opportunity",
        title: "Opportunity: Acme Renewal",
        summary: "Acme requested renewal proposal.",
        sourceTitle: "Renewal request",
        sourceSender: "Kim <kim@acme.example.com>",
        status: "converted",
        metadata: {
          mailIntelligence: {
            evidenceItems: ["proposal requested"],
            nextActions: [{ recommendedAction: "send draft" }],
          },
          aiRevalidation: {
            evidence: [{ sourceType: "mail", quoteOrSummary: "proposal requested" }],
          },
        },
      }),
    ).toEqual({
      id: "candidate-1",
      candidateType: "opportunity",
      title: "Opportunity: Acme Renewal",
      summary: "Acme requested renewal proposal.",
      sourceTitle: "Renewal request",
      sourceSender: "Kim <kim@acme.example.com>",
      status: "converted",
      evidenceItems: ["proposal requested"],
      nextActions: ["send draft"],
      aiEvidence: ["mail: proposal requested"],
    });
  });

  it("builds evidence links for every created downstream entity", () => {
    expect(
      buildMailEvidenceLinkInputs("candidate-1", {
        customerId: "customer-1",
        contactId: "contact-1",
        opportunityId: "opportunity-1",
        proposalId: "proposal-1",
      }),
    ).toEqual([
      {
        mailDerivedCandidateId: "candidate-1",
        targetEntityType: "customer",
        targetEntityId: "customer-1",
        linkType: "primary_outcome",
      },
      {
        mailDerivedCandidateId: "candidate-1",
        targetEntityType: "contact",
        targetEntityId: "contact-1",
        linkType: "supporting_contact",
      },
      {
        mailDerivedCandidateId: "candidate-1",
        targetEntityType: "opportunity",
        targetEntityId: "opportunity-1",
        linkType: "primary_outcome",
      },
      {
        mailDerivedCandidateId: "candidate-1",
        targetEntityType: "proposal",
        targetEntityId: "proposal-1",
        linkType: "proposal_source",
      },
    ]);
  });
});
