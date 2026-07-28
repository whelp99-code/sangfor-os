import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction, type Prisma } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";
import { type AuditChainScope } from "../governance/audit-chain";

export class CrmServiceError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CrmServiceError";
  }
}

type ScopedTransaction = Prisma.TransactionClient;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const boundedText = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((val) => !CONTROL_CHARACTERS.test(val), {
    message: "control_characters_not_allowed",
  });

const idempotencyKeySchema = boundedText(1, 128);

export const BANT_TF_V1_VERSION = "bant-tf-v1";
export const QUALIFICATION_PASS_THRESHOLD = 60;

export const qualifyOpportunitySchema = z
  .object({
    budgetScore: z.number().int().min(0).max(20),
    authorityScore: z.number().int().min(0).max(20),
    needScore: z.number().int().min(0).max(24),
    timelineScore: z.number().int().min(0).max(16),
    technicalFitScore: z.number().int().min(0).max(20),
    expectedRevision: z.number().int().min(0).optional().default(0),
    notes: z.preprocess(
      (val) => (val === "" ? null : val),
      z.string().trim().max(2000).nullable().optional(),
    ),
    economicBuyerId: z.preprocess(
      (val) => (val === "" ? null : val),
      z.string().trim().nullable().optional(),
    ),
    championId: z.preprocess(
      (val) => (val === "" ? null : val),
      z.string().trim().nullable().optional(),
    ),
    idempotencyKey: idempotencyKeySchema.optional().default("default-idempotency-key"),
  })
  .strip();

export type QualifyOpportunityCommandInput = z.input<typeof qualifyOpportunitySchema>;
export type QualifyOpportunityCommand = z.infer<typeof qualifyOpportunitySchema>;

export type BantTfV1Scores = {
  budgetScore: number;
  authorityScore: number;
  needScore: number;
  timelineScore: number;
  technicalFitScore: number;
};

export type EvaluationResult = {
  scoreTotal: number;
  weightedScore: number;
  passed: boolean;
  scoringVersion: typeof BANT_TF_V1_VERSION;
};

export function evaluateBantTfV1(scores: BantTfV1Scores): EvaluationResult {
  const scoreTotal =
    scores.budgetScore +
    scores.authorityScore +
    scores.needScore +
    scores.timelineScore +
    scores.technicalFitScore;

  const passed = scoreTotal >= QUALIFICATION_PASS_THRESHOLD;

  return {
    scoreTotal,
    weightedScore: scoreTotal,
    passed,
    scoringVersion: BANT_TF_V1_VERSION,
  };
}

export function isQualificationPassing(qualification: {
  scoringVersion?: string | null;
  passed?: boolean | null;
  scoreTotal?: number | null;
} | null | undefined): boolean {
  if (!qualification) return false;
  return qualification.scoringVersion === BANT_TF_V1_VERSION && qualification.passed === true;
}

function assertCapability(ctx: AuthContext, required: "opportunity.write" | "customer.write") {
  const perms = (ctx.permissions as string[]) ?? [];
  if (!perms.includes(required) && !perms.includes("opportunity.write") && !perms.includes("customer.write")) {
    throw new CrmServiceError("FORBIDDEN", 403, `missing_permission_${required}`);
  }
}

function projectAuditScope(ctx: AuthContext): AuditChainScope {
  return {
    level: "PROJECT",
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: ctx.projectId ?? ctx.companyId,
  };
}

function inputHash(contract: string, ctx: AuthContext, payload: unknown): string {
  const canonical = canonicalizeRfc8785({
    contract,
    tenantId: ctx.tenantId,
    projectId: ctx.projectId,
    payload,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

async function checkReplay<T>(
  tx: ScopedTransaction,
  scope: AuditChainScope,
  key: string,
  contract: string,
  hash: string,
): Promise<T | null> {
  const existing = await tx.auditLog.findFirst({
    where: {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      projectId: scope.projectId,
      idempotencyKey: key,
    },
    select: { details: true },
  });
  if (!existing) return null;

  const details = existing.details as { contract?: string; inputHash?: string; result?: unknown } | null;
  if (details?.contract !== contract || details?.inputHash !== hash || !details.result) {
    throw new CrmServiceError("CONFLICT", 409, "idempotency_key_reused_with_different_payload");
  }
  return details.result as T;
}

export async function qualifyOpportunity(
  ctx: AuthContext,
  opportunityId: string,
  rawCommand: QualifyOpportunityCommandInput,
) {
  assertCapability(ctx, "opportunity.write");
  const command = qualifyOpportunitySchema.parse(rawCommand);
  const contract = "sangfor.crm.opportunity.qualify/v1";
  const hash = inputHash(contract, ctx, { opportunityId, ...command });
  const auditKey = `opportunity.qualify:${command.idempotencyKey}`;
  const scope = projectAuditScope(ctx);

  return withRlsTransaction(ctx, async (tx) => {
    const replayResult = await checkReplay<typeof qualification>(tx, scope, auditKey, contract, hash);
    if (replayResult) return replayResult;

    const opp = await tx.opportunity.findFirst({
      where: {
        id: opportunityId,
        projectId: ctx.projectId,
      },
    });

    if (!opp) {
      throw new CrmServiceError("NOT_FOUND", 404, "opportunity_not_found");
    }

    // Validate Economic Buyer contact if provided
    if (command.economicBuyerId) {
      const buyer = await tx.contact.findFirst({
        where: {
          id: command.economicBuyerId,
          ...(opp.customerId ? { customerId: opp.customerId } : {}),
        },
      });
      if (!buyer) {
        throw new CrmServiceError("INVALID_ARGUMENT", 422, "foreign_economic_buyer_contact_not_allowed");
      }
    }

    // Validate Champion contact if provided
    if (command.championId) {
      const champion = await tx.contact.findFirst({
        where: {
          id: command.championId,
          ...(opp.customerId ? { customerId: opp.customerId } : {}),
        },
      });
      if (!champion) {
        throw new CrmServiceError("INVALID_ARGUMENT", 422, "foreign_champion_contact_not_allowed");
      }
    }

    // Find active assignment ID
    const assignment = await tx.userCompanyRole.findFirst({
      where: {
        userId: ctx.userId,
        companyId: ctx.companyId,
        status: "active",
      },
      select: { id: true },
    });

    const existing = await tx.dealQualification.findUnique({
      where: { opportunityId },
    });

    const currentRevision = existing?.revision ?? 0;
    if (currentRevision !== command.expectedRevision) {
      throw new CrmServiceError("CONFLICT", 409, "stale_qualification_revision_conflict");
    }

    const nextRevision = currentRevision + 1;
    const evaluation = evaluateBantTfV1(command);
    const now = new Date();

    const snapshotHash = createHash("sha256")
      .update(
        canonicalizeRfc8785({
          opportunityId,
          revision: nextRevision,
          evaluation,
          assessedByAssignmentId: assignment?.id ?? null,
          assessedAt: now.toISOString(),
        }),
      )
      .digest("hex");

    const qualificationData = {
      budgetScore: command.budgetScore,
      authorityScore: command.authorityScore,
      needScore: command.needScore,
      timelineScore: command.timelineScore,
      technicalFitScore: command.technicalFitScore,
      scoreTotal: evaluation.scoreTotal,
      weightedScore: evaluation.weightedScore,
      passed: evaluation.passed,
      scoringVersion: BANT_TF_V1_VERSION,
      revision: nextRevision,
      assessedByAssignmentId: assignment?.id ?? null,
      assessedAt: now,
      updatedAt: now,
      snapshotHash,
      notes: command.notes ?? null,
      economicBuyerId: command.economicBuyerId ?? null,
      championId: command.championId ?? null,
      qualifiedBy: ctx.userId,
      qualifiedAt: now,
    };

    let qualification;
    if (existing) {
      qualification = await tx.dealQualification.update({
        where: { opportunityId },
        data: qualificationData,
        include: {
          economicBuyer: true,
          champion: true,
          assessedByAssignment: true,
        },
      });
    } else {
      qualification = await tx.dealQualification.create({
        data: {
          opportunityId,
          ...qualificationData,
        },
        include: {
          economicBuyer: true,
          champion: true,
          assessedByAssignment: true,
        },
      });
    }

    await appendAuditEvent(tx, {
      scope,
      eventType: evaluation.passed ? "opportunity.qualified" : "opportunity.qualification_updated",
      actorId: assignment?.id ?? ctx.userId,
      resourceType: "deal_qualification",
      resourceId: qualification.id,
      idempotencyKey: auditKey,
      details: JSON.parse(JSON.stringify({ contract, inputHash: hash, result: qualification })),
    });

    return qualification;
  });
}
