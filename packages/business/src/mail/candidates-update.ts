import { prisma } from "@sangfor/db";
import { z } from "zod";

import { createCustomer, createPartner } from "../crm/customer-partner";
import { createImprovementCandidateFromError } from "../orchestration/improvement-loop";
import { resolveDefaultProjectId } from "../infrastructure/default-project";
import { upsertPolicyMemory } from "./mail-policy-memory";
import { upsertDomainMemory } from "../domain-ai/domain-memory";
import { createOpportunity } from "../crm/opportunity-center";
import { createPocProject } from "../crm/poc-center";
import { createWorkTask, linkTaskToEntity } from "../orchestration/task-center";

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

async function convertCustomer(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const projectId = await resolveDefaultProjectId(prisma);
  const existing = await prisma.customer.findFirst({
    where: { projectId, name: candidate.title.replace(/^Customer:\s*/i, "") },
  });
  if (existing) return existing;
  return createCustomer({
    projectSlug: "demo-project",
    name: candidate.title.replace(/^Customer:\s*/i, ""),
    notes: `Created from approved mail candidate.\n\n${candidate.summary}`,
  });
}

async function convertPartner(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const projectId = await resolveDefaultProjectId(prisma);
  const name = candidate.title.replace(/^Partner:\s*/i, "");
  const existing = await prisma.partner.findFirst({
    where: { projectId, name },
  });
  if (existing) return existing;
  return createPartner({
    projectSlug: "demo-project",
    name,
    partnerType: "mail-derived",
  });
}

async function convertTask(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const task = await createWorkTask({
    projectSlug: "demo-project",
    title: candidate.title.replace(/^Follow up:\s*/i, ""),
    status: "todo",
    priority: candidate.confidence >= 80 ? "high" : "normal",
    source: "mail_candidate",
  });
  if (candidate.knowledgeDocumentId) {
    await linkTaskToEntity(task.id, {
      entityType: "mail_message",
      entityId: candidate.knowledgeDocumentId,
      linkType: "derived_from",
    });
  }
  return task;
}

async function convertOpportunity(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  return createOpportunity({
    title: candidate.title.replace(/^Opportunity:\s*/i, ""),
    stage: "lead",
    probability: candidate.confidence >= 80 ? 35 : 20,
    nextAction: `Review approved mail candidate: ${candidate.summary.slice(0, 180)}`,
  });
}

async function convertPoc(candidate: Awaited<ReturnType<typeof getMailDerivedCandidate>>) {
  const poc = await createPocProject({
    projectSlug: "demo-project",
    title: candidate.title.replace(/^PoC:\s*/i, ""),
    productName: "Sangfor",
    requirements: candidate.summary,
  });
  if (!poc) throw new Error("poc_create_failed");
  return poc;
}

export async function approveMailDerivedCandidate(id: string) {
  const candidate = await getMailDerivedCandidate(id);
  if (candidate.status === "converted" && candidate.createdEntityId) {
    return { candidate, created: null };
  }
  if (candidate.status === "rejected") {
    throw new Error("candidate_rejected");
  }
  if (candidate.status === "needs_revalidation") {
    throw new Error("project_candidate_requires_ai_revalidation");
  }
  if (candidate.status === "knowledge_only") {
    throw new Error("candidate_marked_knowledge_only");
  }
  if (isProjectCandidateType(candidate.candidateType)) {
    const metadata = asRecord(candidate.metadata);
    const revalidation = asRecord(metadata.aiRevalidation);
    if (
      revalidation.decision !== "approve_candidate" &&
      revalidation.decision !== "needs_human_review"
    ) {
      throw new Error("project_candidate_requires_ai_revalidation");
    }
  }

  let created: { id: string };
  if (candidate.candidateType === "customer") {
    created = await convertCustomer(candidate);
  } else if (candidate.candidateType === "partner") {
    created = await convertPartner(candidate);
  } else if (candidate.candidateType === "task") {
    created = await convertTask(candidate);
  } else if (candidate.candidateType === "opportunity") {
    created = await convertOpportunity(candidate);
  } else if (candidate.candidateType === "poc") {
    created = await convertPoc(candidate);
  } else {
    throw new Error("unsupported_candidate_type");
  }

  const updated = await prisma.mailDerivedCandidate.update({
    where: { id },
    data: {
      status: "converted",
      createdEntityType: candidate.candidateType,
      createdEntityId: created.id,
    },
  });
  const projectId = await resolveDefaultProjectId(prisma);
  const domain = gtmDomainForCandidate(candidate.candidateType);
  await recordDecision({
    projectId,
    domain,
    actor: domain === "presales" ? "presales" : "sales",
    actionType: "candidate_approved_converted",
    caseRef: caseRefFor("mailCandidate", id),
    input: toInputJson({
      candidateType: candidate.candidateType,
      title: candidate.title,
      metadata: candidate.metadata,
    }),
    output: toInputJson({
      createdEntityType: candidate.candidateType,
      createdEntityId: created.id,
    }),
  });
  await reinforcePolicyMemoryFromApproval(updated);
  return { candidate: updated, created };
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
