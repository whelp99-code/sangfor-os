import { createHash } from "node:crypto";

import {
  hasCapability,
  isActiveProjectAssignment,
  resolveActiveCompanyRole,
  type AuthContext,
} from "@sangfor/auth";
import { canonicalizeRfc8785, prisma, withRlsTransaction, type Prisma } from "@sangfor/db";
import { z } from "zod";

import { createImprovementCandidateFromError } from "../orchestration/improvement-loop";
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
import { appendAuditEvent } from "../governance/audit-db";
import { deriveChainScopeKey } from "../governance/audit-chain";
import { CrmServiceError } from "../crm/customer-partner";
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

export async function listScopedMailDerivedCandidates(
  ctx: AuthContext,
  input: z.input<typeof listMailCandidatesSchema> = {},
) {
  const parsed = listMailCandidatesSchema.parse(input);
  return withRlsTransaction(ctx, (tx) =>
    tx.mailDerivedCandidate.findMany({
      where: {
        ...(parsed.status ? { status: parsed.status } : {}),
        ...(parsed.candidateType ? { candidateType: parsed.candidateType } : {}),
      },
      orderBy: [
        { status: "asc" },
        { confidence: "desc" },
        { createdAt: "desc" },
      ],
      take: parsed.limit,
    }),
  );
}

export async function getMailDerivedCandidate(id: string) {
  return prisma.mailDerivedCandidate.findUniqueOrThrow({ where: { id } });
}

export async function getScopedMailDerivedCandidateWithClient(
  client: Prisma.TransactionClient,
  ctx: AuthContext,
  id: string,
) {
  const candidate = await client.mailDerivedCandidate.findFirst({
    where: { id },
    include: { mailInsightThread: true },
  });
  if (!candidate) return null;
  const projectIds: string[] = [];
  if (candidate.mailInsightThreadId) {
    if (!candidate.mailInsightThread?.projectId) return null;
    projectIds.push(candidate.mailInsightThread.projectId);
  }
  if (candidate.knowledgeDocumentId) {
    const document = await client.knowledgeDocument.findFirst({
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
}

export async function getScopedMailDerivedCandidate(ctx: AuthContext, id: string) {
  return withRlsTransaction(ctx, (tx) =>
    getScopedMailDerivedCandidateWithClient(tx, ctx, id),
  );
}

const manualCandidateCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reject"),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().trim().min(1).max(128),
    reasonCode: z.string().trim().min(1).max(100),
    note: z.string().trim().max(2_000).optional(),
  }).strict(),
  z.object({
    action: z.literal("set_candidate_type"),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().trim().min(1).max(128),
    candidateType: z.enum(["customer", "partner"]),
  }).strict(),
]);

type ManualCandidateCommand = z.input<typeof manualCandidateCommandSchema>;

async function resolveManualCandidateActor(tx: Prisma.TransactionClient, ctx: AuthContext) {
  const now = new Date();
  const [assignments, projectAssignment] = await Promise.all([
    tx.userCompanyRole.findMany({
      where: { userId: ctx.userId, companyId: ctx.companyId },
      select: {
        id: true,
        userId: true,
        companyId: true,
        role: true,
        status: true,
        validFrom: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
    tx.projectMember.findFirst({
      where: { userId: ctx.userId, projectId: ctx.projectId },
      select: {
        id: true,
        userId: true,
        projectId: true,
        status: true,
        validFrom: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  ]);
  const resolved = resolveActiveCompanyRole(assignments, now);
  if (
    !resolved.ok ||
    !isActiveProjectAssignment(projectAssignment, now) ||
    !hasCapability(resolved.role, "customer.write")
  ) {
    throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_manual_command_denied");
  }
  return resolved.assignment;
}

async function loadScopedCandidate(
  tx: Prisma.TransactionClient,
  ctx: AuthContext,
  id: string,
) {
  const candidate = await tx.mailDerivedCandidate.findFirst({
    where: { id },
    include: { mailInsightThread: { select: { projectId: true } } },
  });
  if (!candidate) {
    throw new CrmServiceError("NOT_FOUND", 404, "mail_candidate_not_found");
  }
  const projectIds: string[] = [];
  if (candidate.mailInsightThreadId) {
    if (!candidate.mailInsightThread?.projectId) {
      throw new CrmServiceError("NOT_FOUND", 404, "mail_candidate_not_found");
    }
    projectIds.push(candidate.mailInsightThread.projectId);
  }
  if (candidate.knowledgeDocumentId) {
    const document = await tx.knowledgeDocument.findFirst({
      where: { id: candidate.knowledgeDocumentId },
      select: { projectId: true },
    });
    if (!document) {
      throw new CrmServiceError("NOT_FOUND", 404, "mail_candidate_not_found");
    }
    projectIds.push(document.projectId);
  }
  if (
    projectIds.length === 0 ||
    new Set(projectIds).size !== 1 ||
    projectIds.some((projectId) => projectId !== ctx.projectId)
  ) {
    throw new CrmServiceError("NOT_FOUND", 404, "mail_candidate_not_found");
  }
  return candidate;
}

function manualCommandHash(
  ctx: AuthContext,
  actorAssignmentId: string,
  candidateId: string,
  command: z.output<typeof manualCandidateCommandSchema>,
) {
  return createHash("sha256")
    .update(canonicalizeRfc8785({
      contract: "sangfor.mail_candidate.manual_command/v1",
      scope: { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId },
      actorAssignmentId,
      candidateId,
      command,
    }))
    .digest("hex");
}

export async function executeScopedMailCandidateManualCommand(
  ctx: AuthContext,
  id: string,
  rawCommand: ManualCandidateCommand,
) {
  const command = manualCandidateCommandSchema.parse(rawCommand);
  const scope = {
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
    level: "PROJECT" as const,
  };
  const auditKey = `mail_candidate.${command.action}:${command.idempotencyKey}`;
  const result = await withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveManualCandidateActor(tx, ctx);
    const inputHash = manualCommandHash(ctx, actor.id, id, command);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deriveChainScopeKey(scope)}, 0))`;
    const prior = await tx.auditLog.findFirst({
      where: { chainScopeKey: deriveChainScopeKey(scope), idempotencyKey: auditKey },
    });
    if (prior) {
      const details = prior.details && typeof prior.details === "object" && !Array.isArray(prior.details)
        ? prior.details as Record<string, unknown>
        : {};
      if (
        details.contract !== "sangfor.mail_candidate.manual_command/v1" ||
        details.inputHash !== inputHash
      ) {
        throw new CrmServiceError("CONFLICT", 409, "mail_candidate_idempotency_conflict");
      }
      return { candidate: await loadScopedCandidate(tx, ctx, id), replayed: true };
    }

    const candidate = await loadScopedCandidate(tx, ctx, id);
    if (candidate.updatedAt.getTime() !== new Date(command.expectedUpdatedAt).getTime()) {
      throw new CrmServiceError("CONFLICT", 409, "mail_candidate_version_conflict");
    }
    if (candidate.status !== "proposed" && candidate.status !== "needs_revalidation") {
      throw new CrmServiceError("CONFLICT", 409, "mail_candidate_status_conflict");
    }
    if (
      command.action === "set_candidate_type" &&
      !CORRECTABLE_CANDIDATE_TYPES.has(candidate.candidateType)
    ) {
      throw new CrmServiceError("CONFLICT", 409, "candidate_type_not_correctable");
    }
    const metadata = asRecord(candidate.metadata);
    const changed = await tx.mailDerivedCandidate.updateMany({
      where: { id, updatedAt: candidate.updatedAt, status: candidate.status },
      data: command.action === "reject"
        ? {
            status: "rejected",
            metadata: toInputJson({
              ...metadata,
              rejection: {
                reasonCode: command.reasonCode,
                note: command.note,
                rejectedAt: new Date().toISOString(),
              },
            }),
          }
        : { candidateType: command.candidateType },
    });
    if (changed.count !== 1) {
      throw new CrmServiceError("CONFLICT", 409, "mail_candidate_version_conflict");
    }
    const updated = await loadScopedCandidate(tx, ctx, id);
    await appendAuditEvent(tx, {
      scope,
      eventType: command.action === "reject"
        ? "mail_candidate.rejected"
        : "mail_candidate.type_corrected",
      actorId: actor.id,
      resourceType: "mail_candidate",
      resourceId: id,
      idempotencyKey: auditKey,
      details: {
        contract: "sangfor.mail_candidate.manual_command/v1",
        inputHash,
        actorAssignmentId: actor.id,
        result: {
          candidateId: updated.id,
          status: updated.status,
          candidateType: updated.candidateType,
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
    });
    return { candidate: updated, replayed: false };
  });

  if (!result.replayed && command.action === "reject") {
    await createImprovementCandidateFromError({
      sourceType: "mail_candidate_rejection",
      sourceId: id,
      message: `Mail candidate rejected: ${result.candidate.title} (${command.reasonCode})`,
      details: {
        candidateType: result.candidate.candidateType,
        reasonCode: command.reasonCode,
        note: command.note,
        policyDecision: asRecord(result.candidate.metadata).policyDecision,
      },
      severity: command.reasonCode === "internal_company" || command.reasonCode === "wrong_entity_role"
        ? "medium"
        : "low",
      suggestedModule: "mail-policy-memory",
    });
    await maybeProposePolicyMemoryFromRejection(result.candidate, command.reasonCode);
    await recordRejectionAsNegativeMemory(result.candidate, command.reasonCode);
  }
  if (!result.replayed && command.action === "set_candidate_type") {
    await recordDecision({
      projectId: ctx.projectId,
      domain: gtmDomainForCandidate(command.candidateType),
      actor: "human",
      actionType: "entity_edit",
      caseRef: caseRefFor("mailCandidate", id),
      outcome: "corrected",
      humanEdit: {
        previousCandidateType: command.candidateType === "customer" ? "partner" : "customer",
        candidateType: command.candidateType,
      },
    });
  }
  return result.candidate;
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
    approveProposed: true,
  });
}

const CORRECTABLE_CANDIDATE_TYPES = new Set(["customer", "partner"]);

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
