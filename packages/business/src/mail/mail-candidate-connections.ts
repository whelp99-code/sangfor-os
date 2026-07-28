import type { AuthContext } from "@sangfor/auth";
import { Prisma, prisma } from "@sangfor/db";
import { PROPOSAL_TEMPLATE_KEYS } from "@sangfor/shared";
import { z } from "zod";

import { mailCandidateNextAction, normalizeDealTitle, withTag } from "../crm/deal-title";
import { convertApprovedMailCandidates } from "./mail-candidates-convert";

export const approveAndConnectMailCandidateSchema = z.object({
  candidateId: z.string().trim().min(1).max(200),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().trim().min(1).max(128),
}).strict();

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
  const stripped = candidate.title.replace(/^(Customer|Partner|Opportunity|PoC|Follow up):\s*/i, "").trim();
  return withTag(normalizeDealTitle(stripped));
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
      nextAction: mailCandidateNextAction(candidate.summary),
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
  ctx: AuthContext,
  input: z.input<typeof approveAndConnectMailCandidateSchema>,
) {
  const parsed = approveAndConnectMailCandidateSchema.parse(input);
  return convertApprovedMailCandidates(ctx, {
    candidates: [{
      id: parsed.candidateId,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
    }],
    idempotencyKey: parsed.idempotencyKey,
    approveProposed: true,
  });
}
