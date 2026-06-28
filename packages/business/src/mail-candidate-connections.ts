import { Prisma, prisma } from "@sangfor/db";
import { PROPOSAL_TEMPLATE_KEYS } from "@sangfor/shared";
import { z } from "zod";

import { createContact, createCustomer } from "./customer-partner";
import { addOpportunityLink, createOpportunity, updateOpportunity } from "./opportunity-center";
import { generateProposal } from "./proposal-generator";

export const approveAndConnectMailCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    customer: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), id: z.string().min(1) }),
      z.object({ mode: z.literal("create"), name: z.string().min(2), domain: z.string().optional() }),
    ]),
    contact: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("skip") }),
      z.object({ mode: z.literal("existing"), id: z.string().min(1) }),
      z.object({
        mode: z.literal("create"),
        name: z.string().min(2),
        email: z.string().email().optional(),
        role: z.string().optional(),
      }),
    ]),
    opportunity: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("skip") }),
      z.object({ mode: z.literal("existing"), id: z.string().min(1) }),
      z.object({
        mode: z.literal("create"),
        title: z.string().min(2),
        nextAction: z.string().optional(),
      }),
    ]),
    proposal: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("skip") }),
      z.object({
        mode: z.literal("create"),
        title: z.string().min(2),
        templateKey: z.enum(PROPOSAL_TEMPLATE_KEYS).default("standard-proposal"),
      }),
    ]),
  })
  .superRefine((value, ctx) => {
    if (value.proposal.mode === "create" && value.opportunity.mode === "skip") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposal"],
        message: "proposal_requires_opportunity",
      });
    }
  });

type MailCandidateForConnection = {
  id: string;
  candidateType: string;
  title: string;
  summary: string;
  sourceSender?: string | null;
  sourceTitle?: string | null;
  confidence: number;
  metadata?: unknown;
};

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function nestedRecord(metadata: unknown, key: string): Record<string, unknown> {
  const value = metadataRecord(metadata)[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function extractSender(sender?: string | null, fallbackEmail?: string | null) {
  const text = String(sender ?? "").trim();
  const fallback = String(fallbackEmail ?? "").trim().toLowerCase();
  const match = text.match(/^(.+?)\s*<([^>]+)>$/);
  const email = (match?.[2] ?? (text.includes("@") ? text : fallback)).trim().toLowerCase();
  const name = (match?.[1] ?? (text && !text.includes("@") ? text : email.split("@")[0]) ?? "Mail requester").trim();
  return { name: name || "Mail requester", email };
}

function cleanCandidateTitle(candidate: MailCandidateForConnection) {
  return candidate.title.replace(/^(Customer|Partner|Opportunity|PoC|Follow up):\s*/i, "").trim();
}

function domainFromEmail(email: string) {
  return email.includes("@") ? email.split("@")[1]?.toLowerCase() : undefined;
}

function companyNameFromDomain(domain?: string) {
  const label = domain?.split(".")[0]?.replace(/[-_]+/g, " ").trim();
  return label ? label.replace(/\b\w/g, (char) => char.toUpperCase()) : undefined;
}

type ConnectedEntityIds = {
  customerId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  proposalId?: string | null;
};

type MailEvidenceCandidateForSummary = {
  id: string;
  candidateType: string;
  title: string;
  summary: string;
  sourceTitle?: string | null;
  sourceSender?: string | null;
  status: string;
  metadata?: unknown;
};

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
        item != null && typeof item === "object" && !Array.isArray(item)
      ))
    : [];
}

export function summarizeMailEvidenceCandidate(candidate: MailEvidenceCandidateForSummary) {
  const mailIntelligence = nestedRecord(candidate.metadata, "mailIntelligence");
  const aiRevalidation = nestedRecord(candidate.metadata, "aiRevalidation");
  return {
    id: candidate.id,
    candidateType: candidate.candidateType,
    title: candidate.title,
    summary: candidate.summary,
    sourceTitle: candidate.sourceTitle ?? null,
    sourceSender: candidate.sourceSender ?? null,
    status: candidate.status,
    evidenceItems: asStringArray(mailIntelligence.evidenceItems),
    nextActions: asObjectArray(mailIntelligence.nextActions).map((item) =>
      String(item.recommendedAction ?? item.title ?? item.evidence ?? JSON.stringify(item)),
    ),
    aiEvidence: asObjectArray(aiRevalidation.evidence).map((item) =>
      `${String(item.sourceType ?? "source")}: ${String(item.quoteOrSummary ?? item.sourceId ?? "")}`,
    ),
  };
}

export async function listMailEvidenceForEntity(targetEntityType: string, targetEntityId: string) {
  const links = await prisma.mailEvidenceLink.findMany({
    where: { targetEntityType, targetEntityId },
    orderBy: { createdAt: "desc" },
    include: { candidate: true },
  });
  return links.map((link) => ({
    linkId: link.id,
    linkType: link.linkType,
    candidate: summarizeMailEvidenceCandidate(link.candidate),
  }));
}

export function getConnectionResultIds(candidate: { metadata?: unknown }): ConnectedEntityIds {
  const connectionResult = nestedRecord(candidate.metadata, "connectionResult");
  return {
    customerId: typeof connectionResult.customerId === "string" ? connectionResult.customerId : undefined,
    contactId: typeof connectionResult.contactId === "string" ? connectionResult.contactId : undefined,
    opportunityId: typeof connectionResult.opportunityId === "string" ? connectionResult.opportunityId : undefined,
    proposalId: typeof connectionResult.proposalId === "string" ? connectionResult.proposalId : undefined,
  };
}

export function buildMailEvidenceLinkInputs(
  mailDerivedCandidateId: string,
  ids: ConnectedEntityIds,
) {
  return [
    ids.customerId
      ? {
          mailDerivedCandidateId,
          targetEntityType: "customer",
          targetEntityId: ids.customerId,
          linkType: "primary_outcome",
        }
      : null,
    ids.contactId
      ? {
          mailDerivedCandidateId,
          targetEntityType: "contact",
          targetEntityId: ids.contactId,
          linkType: "supporting_contact",
        }
      : null,
    ids.opportunityId
      ? {
          mailDerivedCandidateId,
          targetEntityType: "opportunity",
          targetEntityId: ids.opportunityId,
          linkType: "primary_outcome",
        }
      : null,
    ids.proposalId
      ? {
          mailDerivedCandidateId,
          targetEntityType: "proposal",
          targetEntityId: ids.proposalId,
          linkType: "proposal_source",
        }
      : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isProjectCandidateType(candidateType: string) {
  return candidateType === "task" || candidateType === "opportunity" || candidateType === "poc";
}

function assertCandidateApprovable(candidate: { status: string; candidateType: string; metadata?: unknown }) {
  if (candidate.status === "converted") return;
  if (candidate.status === "rejected") throw new Error("candidate_rejected");
  if (candidate.status === "knowledge_only") throw new Error("candidate_marked_knowledge_only");
  if (candidate.status === "needs_revalidation") throw new Error("project_candidate_requires_ai_revalidation");
  if (isProjectCandidateType(candidate.candidateType)) {
    const revalidation = nestedRecord(candidate.metadata, "aiRevalidation");
    if (
      revalidation.decision !== "approve_candidate" &&
      revalidation.decision !== "needs_human_review"
    ) {
      throw new Error("project_candidate_requires_ai_revalidation");
    }
  }
}

export function buildMailCandidateConnectionDefaults(candidate: MailCandidateForConnection) {
  const metadata = metadataRecord(candidate.metadata);
  const mailIntelligence = nestedRecord(candidate.metadata, "mailIntelligence");
  const aiRevalidation = nestedRecord(candidate.metadata, "aiRevalidation");
  const metadataEmail = typeof metadata.email === "string" ? metadata.email : undefined;
  const sender = extractSender(candidate.sourceSender, metadataEmail);
  const title = cleanCandidateTitle(candidate);
  const participantDomains = asStringArray(metadata.participantDomains);
  const senderDomain = domainFromEmail(sender.email);
  const domain = senderDomain ?? participantDomains[0];
  const customerName = metadata.legacyKnowledgeFallback === true
    ? (companyNameFromDomain(domain) ?? title)
    : title;
  const evidenceItems = asStringArray(mailIntelligence.evidenceItems);

  return {
    customer: {
      name: customerName,
      domain,
      notes: `Created from approved mail candidate.\n\n${candidate.summary}`,
    },
    contact: sender.email
      ? {
          name: sender.name,
          email: sender.email,
          role: "Mail requester",
        }
      : null,
    opportunity: {
      title,
      nextAction: `Review approved mail candidate: ${candidate.summary.slice(0, 180)}`,
      probability: candidate.confidence >= 80 ? 35 : 20,
    },
    proposal: {
      title: `Proposal — ${title}`,
      templateKey: candidate.candidateType === "poc" ? "poc-summary" : "standard-proposal",
    },
    evidence: {
      summary: candidate.summary,
      items: evidenceItems,
      nextActions: asObjectArray(mailIntelligence.nextActions).map((item) =>
        String(item.recommendedAction ?? item.title ?? item.evidence ?? JSON.stringify(item)),
      ),
      sourceTitle: candidate.sourceTitle ?? null,
      sourceSender: candidate.sourceSender ?? null,
      sourceMessageIds: asStringArray(metadata.sourceMessageIds),
      missingFields: asStringArray(aiRevalidation.missingFields),
      riskFlags: asStringArray(aiRevalidation.riskFlags),
    },
  };
}

export async function approveAndConnectMailCandidate(
  input: z.input<typeof approveAndConnectMailCandidateSchema>,
) {
  const parsed = approveAndConnectMailCandidateSchema.parse(input);
  const candidate = await prisma.mailDerivedCandidate.findUniqueOrThrow({
    where: { id: parsed.candidateId },
  });
  assertCandidateApprovable(candidate);

  if (candidate.status === "converted") {
    const ids = getConnectionResultIds(candidate);
    if (!ids.customerId || !ids.opportunityId) {
      throw new Error("converted_candidate_missing_connection_result");
    }
    return {
      candidate,
      customer: await prisma.customer.findUniqueOrThrow({ where: { id: ids.customerId } }),
      contact: ids.contactId
        ? await prisma.contact.findUniqueOrThrow({ where: { id: ids.contactId } })
        : null,
      opportunity: await prisma.opportunity.findUniqueOrThrow({ where: { id: ids.opportunityId } }),
      proposal: ids.proposalId
        ? await prisma.generatedDocument.findUniqueOrThrow({ where: { id: ids.proposalId } })
        : null,
    };
  }

  const defaults = buildMailCandidateConnectionDefaults(candidate);
  const existingContact = parsed.contact.mode === "existing"
    ? await prisma.contact.findUniqueOrThrow({ where: { id: parsed.contact.id } })
    : null;
  const existingOpportunity = parsed.opportunity.mode === "existing"
    ? await prisma.opportunity.findUniqueOrThrow({ where: { id: parsed.opportunity.id } })
    : null;

  if (existingContact?.customerId) {
    if (parsed.customer.mode === "create" || existingContact.customerId !== parsed.customer.id) {
      throw new Error("contact_customer_mismatch");
    }
  }
  if (existingOpportunity?.customerId) {
    if (parsed.customer.mode === "create" || existingOpportunity.customerId !== parsed.customer.id) {
      throw new Error("customer_mismatch");
    }
  }

  const customer = parsed.customer.mode === "existing"
    ? await prisma.customer.findUniqueOrThrow({ where: { id: parsed.customer.id } })
    : await createCustomer({
        projectSlug: "demo-project",
        name: parsed.customer.name,
        domain: parsed.customer.domain ?? defaults.customer.domain,
        notes: defaults.customer.notes,
      });

  const contact = parsed.contact.mode === "skip"
    ? null
    : parsed.contact.mode === "existing"
      ? existingContact
      : await createContact({
          customerId: customer.id,
          name: parsed.contact.name,
          email: parsed.contact.email,
          role: parsed.contact.role ?? "Mail requester",
        });

  if (contact?.customerId && contact.customerId !== customer.id) {
    throw new Error("contact_customer_mismatch");
  }

  const opportunity = parsed.opportunity.mode === "skip"
    ? await createOpportunity({
        title: defaults.opportunity.title,
        customerId: customer.id,
        probability: defaults.opportunity.probability,
        nextAction: defaults.opportunity.nextAction,
      })
    : parsed.opportunity.mode === "existing"
      ? existingOpportunity!
      : await createOpportunity({
          title: parsed.opportunity.title,
          customerId: customer.id,
          probability: defaults.opportunity.probability,
          nextAction: parsed.opportunity.nextAction ?? defaults.opportunity.nextAction,
        });

  if (opportunity.customerId && opportunity.customerId !== customer.id) {
    throw new Error("customer_mismatch");
  }
  const connectedOpportunity = opportunity.customerId
    ? opportunity
    : await updateOpportunity(opportunity.id, { customerId: customer.id });

  const proposal = parsed.proposal.mode === "create"
    ? await generateProposal({
        projectSlug: "demo-project",
        title: parsed.proposal.title,
        templateKey: parsed.proposal.templateKey,
        customerId: customer.id,
        opportunityId: connectedOpportunity.id,
        sourceMailCandidateId: candidate.id,
        variables: {
          scope: defaults.evidence.summary,
          timeline: defaults.evidence.items[0] ?? "TBD",
          amount: "TBD",
        },
      })
    : null;

  if (proposal) {
    await addOpportunityLink(connectedOpportunity.id, {
      entityType: "proposal",
      entityId: proposal.id,
      linkType: "draft",
    });
  }

  const linkInputs = buildMailEvidenceLinkInputs(candidate.id, {
    customerId: customer.id,
    contactId: contact?.id,
    opportunityId: connectedOpportunity.id,
    proposalId: proposal?.id,
  });
  for (const link of linkInputs) {
    await prisma.mailEvidenceLink.upsert({
      where: {
        mailDerivedCandidateId_targetEntityType_targetEntityId_linkType: link,
      },
      update: {},
      create: link,
    });
  }

  const candidateMetadata = metadataRecord(candidate.metadata);
  const updatedCandidate = await prisma.mailDerivedCandidate.update({
    where: { id: candidate.id },
    data: {
      status: "converted",
      createdEntityType: "opportunity",
      createdEntityId: connectedOpportunity.id,
      metadata: toPrismaJson({
        ...candidateMetadata,
        connectionResult: {
          customerId: customer.id,
          contactId: contact?.id,
          opportunityId: connectedOpportunity.id,
          proposalId: proposal?.id,
          mode: "mvp_b",
        },
      }),
    },
  });

  return {
    candidate: updatedCandidate,
    customer,
    contact,
    opportunity: connectedOpportunity,
    proposal,
  };
}
