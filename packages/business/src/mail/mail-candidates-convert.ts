import { createHash } from "node:crypto";

import {
  hasCapability,
  isActiveProjectAssignment,
  resolveActiveCompanyRole,
  type AuthContext,
} from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction, type Prisma } from "@sangfor/db";
import { z } from "zod";

import {
  CrmServiceError,
  mergeMailDerivedCustomerInScopedTransaction,
  mergeMailDerivedPartnerInScopedTransaction,
} from "../crm/customer-partner";
import { normalizeDealTitle, withTag } from "../crm/deal-title";
import { mergeMailDerivedOpportunityInScopedTransaction } from "../crm/opportunity-center";
import { appendAuditEvent } from "../governance/audit-db";
import { deriveChainScopeKey } from "../governance/audit-chain";
import { asRecord, toInputJson } from "./classify-rules";
import { deriveEntityFromCandidate } from "./mail-entity-quality";

const candidateRefSchema = z.object({
  id: z.string().trim().min(1).max(200),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export const convertApprovedMailCandidatesSchema = z.object({
  candidates: z.array(candidateRefSchema).min(1).max(100).superRefine((items, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "duplicate_candidate_id",
          path: [index, "id"],
        });
      }
      seen.add(item.id);
    }
  }),
  idempotencyKey: z.string().trim().min(1).max(128),
  approveProposed: z.boolean().default(false),
}).strict();

export type ConvertApprovedMailCandidatesCommand = z.input<
  typeof convertApprovedMailCandidatesSchema
>;

export interface ConvertResult {
  customersCreated: number;
  partnersCreated: number;
  customersSkipped: number;
  partnersSkipped: number;
  customersMerged: number;
  partnersMerged: number;
  opportunitiesCreated: number;
  tasksCreated: number;
  items: Array<{
    candidateId: string;
    entityType: string;
    entityId: string;
    created: boolean;
  }>;
}

type ScopedCandidate = Prisma.MailDerivedCandidateGetPayload<{
  include: { mailInsightThread: { select: { projectId: true } } };
}>;

async function resolveConversionActor(tx: Prisma.TransactionClient, ctx: AuthContext) {
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
    !hasCapability(resolved.role, "customer.write") ||
    !hasCapability(resolved.role, "opportunity.write")
  ) {
    throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_conversion_denied");
  }
  return resolved.assignment;
}

function inputHash(
  ctx: AuthContext,
  actorAssignmentId: string,
  candidates: Array<{ id: string; expectedUpdatedAt: string }>,
  approveProposed: boolean,
): string {
  return createHash("sha256")
    .update(canonicalizeRfc8785({
      contract: "sangfor.mail_candidate.convert/v1",
      scope: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        projectId: ctx.projectId,
      },
      actorAssignmentId,
      candidates,
      approveProposed,
    }))
    .digest("hex");
}

function resultFromAudit(value: unknown): ConvertResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const details = value as Record<string, unknown>;
  const result = details.result;
  return result && typeof result === "object" && !Array.isArray(result)
    ? result as unknown as ConvertResult
    : null;
}

function entityId(entity: unknown): string {
  if (
    !entity ||
    typeof entity !== "object" ||
    !("id" in entity) ||
    typeof entity.id !== "string"
  ) {
    throw new CrmServiceError("CONFLICT", 409, "mail_candidate_entity_receipt_invalid");
  }
  return entity.id;
}

async function assertCandidateProvenance(
  tx: Prisma.TransactionClient,
  ctx: AuthContext,
  candidates: ScopedCandidate[],
) {
  const project = await tx.project.findFirst({
    where: { id: ctx.projectId, companyId: ctx.companyId },
    select: { id: true, company: { select: { tenantId: true } } },
  });
  if (!project || !project.company || project.company.tenantId !== ctx.tenantId) {
    throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_project_scope_invalid");
  }

  const documentIds = candidates
    .map((candidate) => candidate.knowledgeDocumentId)
    .filter((id): id is string => Boolean(id));
  const documents = documentIds.length > 0
    ? await tx.knowledgeDocument.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, projectId: true },
      })
    : [];
  const documentProjects = new Map(documents.map((document) => [document.id, document.projectId]));

  for (const candidate of candidates) {
    const projectIds: string[] = [];
    if (candidate.mailInsightThreadId) {
      const threadProjectId = candidate.mailInsightThread?.projectId;
      if (!threadProjectId) {
        throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_provenance_unverified");
      }
      projectIds.push(threadProjectId);
    }
    if (candidate.knowledgeDocumentId) {
      const documentProjectId = documentProjects.get(candidate.knowledgeDocumentId);
      if (!documentProjectId) {
        throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_provenance_unverified");
      }
      projectIds.push(documentProjectId);
    }
    if (
      projectIds.length === 0 ||
      new Set(projectIds).size !== 1 ||
      projectIds.some((projectId) => projectId !== ctx.projectId)
    ) {
      throw new CrmServiceError("FORBIDDEN", 403, "mail_candidate_provenance_unverified");
    }
  }
}

function inferIndustry(summary?: string | null): string {
  if (!summary) return "IT";
  const text = summary.toLowerCase();
  if (text.includes("보안") || text.includes("security") || text.includes("네트워크")) {
    return "보안/네트워크";
  }
  if (text.includes("소프트웨어") || text.includes("software") || text.includes("개발")) {
    return "IT/소프트웨어";
  }
  if (text.includes("서비스") || text.includes("service")) return "IT/서비스";
  if (text.includes("유통") || text.includes("distribution")) return "IT/유통";
  if (text.includes("제조") || text.includes("manufacturing")) return "제조";
  return "IT";
}

export async function convertApprovedMailCandidates(
  ctx: AuthContext,
  rawCommand: ConvertApprovedMailCandidatesCommand,
): Promise<ConvertResult> {
  const command = convertApprovedMailCandidatesSchema.parse(rawCommand);
  const ordered = [...command.candidates].sort((left, right) => left.id.localeCompare(right.id));
  const scope = {
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: ctx.projectId,
    level: "PROJECT" as const,
  };
  const auditKey = `mail_candidate.convert:${command.idempotencyKey}`;

  return withRlsTransaction(ctx, async (tx) => {
    const actor = await resolveConversionActor(tx, ctx);
    const hash = inputHash(ctx, actor.id, ordered, command.approveProposed);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${deriveChainScopeKey(scope)}, 0))`;
    const prior = await tx.auditLog.findFirst({
      where: { chainScopeKey: deriveChainScopeKey(scope), idempotencyKey: auditKey },
    });
    if (prior) {
      const details = prior.details && typeof prior.details === "object" && !Array.isArray(prior.details)
        ? prior.details as Record<string, unknown>
        : {};
      if (
        details.contract !== "sangfor.mail_candidate.convert/v1" ||
        details.inputHash !== hash
      ) {
        throw new CrmServiceError("CONFLICT", 409, "mail_candidate_idempotency_conflict");
      }
      const replay = resultFromAudit(details);
      if (!replay) {
        throw new CrmServiceError("CONFLICT", 409, "mail_candidate_replay_invalid");
      }
      return replay;
    }

    const rows = await tx.mailDerivedCandidate.findMany({
      where: { id: { in: ordered.map((candidate) => candidate.id) } },
      include: { mailInsightThread: { select: { projectId: true } } },
    });
    const byId = new Map(rows.map((candidate) => [candidate.id, candidate]));
    const candidates = ordered.map((expected) => {
      const candidate = byId.get(expected.id);
      if (!candidate) {
        throw new CrmServiceError("NOT_FOUND", 404, "mail_candidate_not_found");
      }
      const statusAllowed = candidate.status === "approved" ||
        (command.approveProposed && candidate.status === "proposed");
      if (
        !statusAllowed ||
        candidate.updatedAt.getTime() !== new Date(expected.expectedUpdatedAt).getTime() ||
        candidate.createdEntityId !== null
      ) {
        throw new CrmServiceError("CONFLICT", 409, "mail_candidate_version_conflict");
      }
      if (command.approveProposed && ["task", "opportunity", "poc"].includes(candidate.candidateType)) {
        const revalidation = asRecord(asRecord(candidate.metadata).aiRevalidation);
        if (
          revalidation.decision !== "approve_candidate" &&
          revalidation.decision !== "needs_human_review"
        ) {
          throw new CrmServiceError("CONFLICT", 409, "project_candidate_requires_ai_revalidation");
        }
      }
      return candidate;
    });
    await assertCandidateProvenance(tx, ctx, candidates);

    const result: ConvertResult = {
      customersCreated: 0,
      partnersCreated: 0,
      customersSkipped: 0,
      partnersSkipped: 0,
      customersMerged: 0,
      partnersMerged: 0,
      opportunitiesCreated: 0,
      tasksCreated: 0,
      items: [],
    };

    for (const candidate of candidates) {
      const entityKey = `${command.idempotencyKey}:${candidate.id}`;
      let converted: { entityType: string; entityId: string; created: boolean };

      if (candidate.candidateType === "customer") {
        const derived = deriveEntityFromCandidate(candidate);
        if (derived.skip) {
          throw new CrmServiceError("CONFLICT", 409, "mail_candidate_entity_unverified");
        }
        const merged = await mergeMailDerivedCustomerInScopedTransaction(tx, ctx, {
          name: derived.name,
          domain: derived.domain,
          industry: inferIndustry(candidate.summary),
          notes: `원본: ${candidate.sourceTitle ?? ""}`,
          idempotencyKey: entityKey,
        });
        converted = {
          entityType: "customer",
          entityId: entityId(merged.entity),
          created: merged.created,
        };
        if (merged.created) result.customersCreated += 1;
        else result.customersMerged += 1;
      } else if (candidate.candidateType === "partner") {
        const derived = deriveEntityFromCandidate(candidate);
        if (derived.skip) {
          throw new CrmServiceError("CONFLICT", 409, "mail_candidate_entity_unverified");
        }
        const metadata = asRecord(candidate.metadata);
        const merged = await mergeMailDerivedPartnerInScopedTransaction(tx, ctx, {
          name: derived.name,
          partnerType: typeof metadata.partnerType === "string" ? metadata.partnerType : null,
        });
        converted = {
          entityType: "partner",
          entityId: entityId(merged.entity),
          created: merged.created,
        };
        if (merged.created) result.partnersCreated += 1;
        else result.partnersMerged += 1;
      } else if (candidate.candidateType === "opportunity") {
        const merged = await mergeMailDerivedOpportunityInScopedTransaction(tx, ctx, {
          title: withTag(normalizeDealTitle(candidate.title.replace(/^Opportunity:\s*/i, ""))),
          probability: candidate.confidence >= 80 ? 35 : 20,
          nextAction: candidate.summary || null,
          idempotencyKey: entityKey,
        });
        converted = {
          entityType: "opportunity",
          entityId: entityId(merged.entity),
          created: merged.created,
        };
        if (merged.created) result.opportunitiesCreated += 1;
      } else if (candidate.candidateType === "task") {
        const title = candidate.title.replace(/^Follow up:\s*/i, "");
        const existing = await tx.workTask.findFirst({
          where: { projectId: ctx.projectId, archivedAt: null, title },
        });
        const task = existing ?? await tx.workTask.create({
          data: {
            projectId: ctx.projectId,
            title,
            status: "todo",
            priority: candidate.confidence >= 80 ? "high" : "normal",
            source: "mail_candidate",
          },
        });
        if (!existing) result.tasksCreated += 1;
        converted = { entityType: "task", entityId: task.id, created: !existing };
      } else {
        throw new CrmServiceError("VALIDATION_ERROR", 422, "unsupported_candidate_type");
      }

      const changed = await tx.mailDerivedCandidate.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          updatedAt: candidate.updatedAt,
          createdEntityId: null,
        },
        data: {
          status: "converted",
          createdEntityType: converted.entityType,
          createdEntityId: converted.entityId,
          metadata: toInputJson({
            ...asRecord(candidate.metadata),
            conversion: {
              actorAssignmentId: actor.id,
              convertedAt: new Date().toISOString(),
            },
          }),
        },
      });
      if (changed.count !== 1) {
        throw new CrmServiceError("CONFLICT", 409, "mail_candidate_version_conflict");
      }
      const item = { candidateId: candidate.id, ...converted };
      result.items.push(item);
      await appendAuditEvent(tx, {
        scope,
        eventType: "mail_candidate.converted",
        actorId: actor.id,
        resourceType: "mail_candidate",
        resourceId: candidate.id,
        idempotencyKey: `${auditKey}:${candidate.id}`,
        details: {
          contract: "sangfor.mail_candidate.convert_item/v1",
          actorAssignmentId: actor.id,
          result: item,
        },
      });
    }

    await appendAuditEvent(tx, {
      scope,
      eventType: "mail_candidates.converted",
      actorId: actor.id,
      resourceType: "mail_candidate_batch",
      resourceId: null,
      idempotencyKey: auditKey,
      details: {
        contract: "sangfor.mail_candidate.convert/v1",
        inputHash: hash,
        actorAssignmentId: actor.id,
        result,
      },
    });
    return result;
  });
}
