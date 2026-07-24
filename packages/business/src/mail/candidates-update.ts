import type { AuthContext } from "@sangfor/auth";
import { prisma, withRlsTransaction } from "@sangfor/db";
import { z } from "zod";

import { createImprovementCandidateFromError } from "../orchestration/improvement-loop";
import { resolveDefaultProjectId } from "../infrastructure/default-project";
import { upsertPolicyMemory } from "./mail-policy-memory";
import { upsertDomainMemory } from "../domain-ai/domain-memory";
import { convertApprovedMailCandidates } from "./mail-candidates-convert";

import { mailCandidateStatusSchema, mailCandidateTypeSchema } from "./constants";
import {
  asRecord,
  asStringArray,
  domainFromEmail,
  isInternalDomain,
  isProjectCandidateType,
  isSystemSenderDomain,
  gtmDomainForCandidate,
  toInputJson,
} from "./classify-rules";
import { recordDecision } from "../governance/ai-decision";
import { caseRefFor } from "../infrastructure/case-ref";

const listMailCandidatesSchema = z.object({
  status: mailCandidateStatusSchema.optional(),
  candidateType: mailCandidateTypeSchema.optional(),
  limit: z.number().int().min(1).max(2_000).default(100),
});

export async function listMailDerivedCandidates(
  input: z.input<typeof listMailCandidatesSchema> = {},
) {
  const parsed = listMailCandidatesSchema.parse(input);
  return prisma.mailDerivedCandidate.findMany({
    where: {
      ...(parsed.status ? { status: parsed.status } : {}),
      ...(parsed.candidateType ? { candidateType: parsed.candidateType } : {}),
    },
    orderBy: [{ status: "asc" }, { confidence: "desc" }, { createdAt: "desc" }],
    take: parsed.limit,
  });
}

export async function getMailDerivedCandidate(id: string) {
  return prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id } });
}

export async function getScopedMailDerivedCandidate(ctx: AuthContext, id: string) {
  return withRlsTransaction(ctx, async (tx) => {
    const candidate = await tx.mailDerivedCandidate.findFirst({
      where: { id },
      include: { mailInsightThread: { select: { projectId: true } } },
    });
    if (!candidate) return null;
    const projectIds: string[] = [];
    if (candidate.mailInsightThreadId) {
      if (!candidate.mailInsightThread?.projectId) return null;
      projectIds.push(candidate.mailInsightThread.projectId);
    }
    if (candidate.knowledgeDocumentId) {
      const document = await tx.knowledgeDocument.findFirst({
        where: { id: candidate.knowledgeDocumentId },
        select: { projectId: true },
      });
      if (!document) return null;
      projectIds.push(document.projectId);
    }
    if (
      projectIds.length === 0 ||
      new Set(projectIds).size !== 1 ||
      projectIds.some((projectId) => projectId !== ctx.projectId)
    ) {
      return null;
    }
    return candidate;
  });
}

const rejectMailCandidateSchema = z.object({
  reasonCode: z.string().min(1).default("manual_reject"),
  note: z.string().optional(),
});

export async function rejectMailDerivedCandidate(
  id: string,
  input: z.input<typeof rejectMailCandidateSchema> = {},
) {
  const parsed = rejectMailCandidateSchema.parse(input);
  const candidate = await getMailDerivedCandidate(id);
  const projectId = await resolveDefaultProjectId(prisma);
  const metadata = asRecord(candidate.metadata);
  const rejection = {
    reasonCode: parsed.reasonCode,
    note: parsed.note,
    rejectedAt: new Date().toISOString(),
  };
  const updated = await prisma.mailDerivedCandidate.update({
    where: { id },
    data: {
      status: "rejected",
      metadata: toInputJson({
        ...metadata,
        rejection,
      }),
    },
  });
  const domain = gtmDomainForCandidate(candidate.candidateType);
  await recordDecision({
    projectId,
    domain,
    actor: domain === "presales" ? "presales" : "sales",
    actionType: "candidate_rejected",
    caseRef: caseRefFor("mailCandidate", id),
    outcome: "rejected",
    input: toInputJson({
      candidateType: candidate.candidateType,
      title: candidate.title,
      metadata,
    }),
    output: toInputJson(rejection),
  });
  await createImprovementCandidateFromError({
    sourceType: "mail_candidate_rejection",
    sourceId: id,
    message: `Mail candidate rejected: ${candidate.title} (${parsed.reasonCode})`,
    details: {
      candidateType: candidate.candidateType,
      reasonCode: parsed.reasonCode,
      note: parsed.note,
      policyDecision: metadata.policyDecision,
    },
    severity: parsed.reasonCode === "internal_company" || parsed.reasonCode === "wrong_entity_role" ? "medium" : "low",
    suggestedModule: "mail-policy-memory",
  });
  await maybeProposePolicyMemoryFromRejection(updated, parsed.reasonCode);
  await recordRejectionAsNegativeMemory(updated, parsed.reasonCode);
  return updated;
}

/**
 * A-8 대칭 학습: 어떤 reasonCode든 거부는 rejected-outcome DomainMemory 로 남는다 —
 * scoreDomainMemory 의 음수 가중 + A-3 same-key 억제가 이 행을 negative 신호로 소비한다.
 * (기존 maybeProposePolicyMemoryFromRejection 은 3개 코드에만 교정 정책을 제안할 뿐,
 * 그 외 거부는 학습 신호가 0이었다.)
 */
async function recordRejectionAsNegativeMemory(
  candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>,
  reasonCode: string,
) {
  const metadata = asRecord(candidate.metadata);
  const senderDomain =
    domainFromEmail(String(metadata.email ?? metadata.sourceSender ?? candidate.sourceSender ?? "")) ??
    asStringArray(metadata.participantDomains)[0];
  const domain = gtmDomainForCandidate(candidate.candidateType);
  try {
    await upsertDomainMemory({
      domain,
      memoryType: "case",
      key: `${caseRefFor("mailCandidate", candidate.id)}:${domain}`,
      label: `rejected: ${candidate.title.slice(0, 80)} (${reasonCode})`,
      tags: [
        `domain:${domain}`,
        `entity:${candidate.candidateType}`,
        "intent:rejected",
        ...(senderDomain ? [`sender:${senderDomain}`] : []),
      ],
      valueJson: { sourceCandidateId: candidate.id, reasonCode },
      outcome: "rejected",
      source: "human",
      confidence: 80,
    });
  } catch (error) {
    console.error("[recordRejectionAsNegativeMemory] failed (swallowed):", error);
  }
}

async function maybeProposePolicyMemoryFromRejection(
  candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>,
  reasonCode: string,
) {
  const metadata = asRecord(candidate.metadata);
  const entityName = candidate.title.replace(/^(Customer|Partner):\s*/i, "").trim();
  const domain =
    domainFromEmail(String(metadata.email ?? metadata.sourceSender ?? candidate.sourceSender ?? "")) ??
    asStringArray(metadata.participantDomains)[0];
  const policyDecision = asRecord(metadata.policyDecision);

  if (reasonCode === "internal_company" && entityName) {
    await upsertPolicyMemory({
      memoryType: "internal_company_name",
      key: entityName,
      label: entityName,
      valueJson: { sourceCandidateId: candidate.id, reasonCode },
      status: "proposed",
      confidence: 75,
    });
  }

  if (reasonCode === "system_sender" && domain) {
    await upsertPolicyMemory({
      memoryType: "system_sender_domain",
      key: domain,
      label: `${domain} system sender`,
      valueJson: { sourceCandidateId: candidate.id, reasonCode },
      status: "proposed",
      confidence: 75,
    });
  }

  if (
    reasonCode === "wrong_entity_role" &&
    candidate.candidateType === "customer" &&
    policyDecision.entityRole === "partner" &&
    entityName
  ) {
    await upsertPolicyMemory({
      memoryType: "known_partner_name",
      key: entityName,
      label: entityName,
      valueJson: { sourceCandidateId: candidate.id, reasonCode },
      status: "proposed",
      confidence: 70,
    });
  }
}

export class CandidateConversionInProgressError extends Error {
  readonly candidateId: string;

  constructor(candidateId: string) {
    super("candidate_conversion_in_progress");
    this.name = "CandidateConversionInProgressError";
    this.candidateId = candidateId;
  }
}

export async function approveMailDerivedCandidate(
  ctx: AuthContext,
  id: string,
  command: { expectedUpdatedAt: string; idempotencyKey: string },
) {
  return convertApprovedMailCandidates(ctx, {
    candidates: [{ id, expectedUpdatedAt: command.expectedUpdatedAt }],
    idempotencyKey: command.idempotencyKey,
  });
}

const setCandidateTypeSchema = z.object({
  candidateType: z.enum(["customer", "partner"]),
});

const CORRECTABLE_CANDIDATE_TYPES = new Set(["customer", "partner"]);

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002",
  );
}

export async function setCandidateType(
  id: string,
  input: z.input<typeof setCandidateTypeSchema>,
) {
  const parsed = setCandidateTypeSchema.parse(input);
  const candidate = await getMailDerivedCandidate(id);
  if (!CORRECTABLE_CANDIDATE_TYPES.has(candidate.candidateType)) {
    throw new Error("candidate_type_not_correctable");
  }
  const projectId = await resolveDefaultProjectId(prisma);

  const previousCandidateType = candidate.candidateType;
  let updated;
  try {
    updated = await prisma.mailDerivedCandidate.update({
      where: { id },
      data: { candidateType: parsed.candidateType },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("candidate_type_conflict", { cause: error });
    }
    throw error;
  }

  // Best-effort decision spine capture — outside txn, never throws.
  await recordDecision({
    projectId,
    domain: gtmDomainForCandidate(parsed.candidateType),
    actor: "human",
    actionType: "entity_edit",
    caseRef: caseRefFor("mailCandidate", id),
    outcome: "corrected",
    humanEdit: { previousCandidateType, candidateType: parsed.candidateType },
  });

  return updated;
}

async function reinforcePolicyMemoryFromApproval(
  candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>,
) {
  const entityName = candidate.title.replace(/^(Customer|Partner):\s*/i, "").trim();
  if (!entityName) return;
  const metadata = asRecord(candidate.metadata);
  const participantDomains = asStringArray(metadata.participantDomains);
  const domain =
    domainFromEmail(String(metadata.email ?? metadata.sourceSender ?? candidate.sourceSender ?? "")) ??
    participantDomains.find((item) => !isInternalDomain(item) && !isSystemSenderDomain(item));

  if (candidate.candidateType === "partner") {
    await upsertPolicyMemory({
      memoryType: "known_partner_name",
      key: entityName,
      label: entityName,
      valueJson: { sourceCandidateId: candidate.id, createdEntityId: candidate.createdEntityId },
      status: "active",
      source: "approval",
      confidence: 95,
    });
    if (domain) {
      await upsertPolicyMemory({
        memoryType: "known_partner_domain",
        key: domain,
        label: `${entityName} domain`,
        valueJson: { sourceCandidateId: candidate.id, createdEntityId: candidate.createdEntityId },
        status: "active",
        source: "approval",
        confidence: 90,
      });
    }
  }

  if (candidate.candidateType === "customer") {
    await upsertPolicyMemory({
      memoryType: "known_customer_name",
      key: entityName,
      label: entityName,
      valueJson: { sourceCandidateId: candidate.id, createdEntityId: candidate.createdEntityId, domain },
      status: "active",
      source: "approval",
      confidence: 85,
    });
  }
}
