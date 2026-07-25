import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";
import { requireCurrentQuoteVendorReadiness } from "../support/vendor-request";
import { requireCurrentAiReleaseEvaluation } from "../governance/ai-release-evaluation-service";

export class DealWorkflowError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "DealWorkflowError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

export type StartDealWorkflowRunCommand = {
  authContext: AuthContext;
  opportunityId: string;
  idempotencyKey: string;
};

export type DealGateStatus = {
  gateKey: string;
  eligible: boolean;
  blocker?: string;
};

export type StartDealWorkflowRunResult = {
  runId: string;
  opportunityId: string;
  definitionKey: string;
  currentStage: string;
  gates: DealGateStatus[];
  idempotent: boolean;
};

export async function startDealWorkflowRun(
  cmd: StartDealWorkflowRunCommand,
): Promise<StartDealWorkflowRunResult> {
  if (!cmd.opportunityId || !cmd.idempotencyKey) {
    throw new DealWorkflowError("INVALID_COMMAND", "opportunityId and idempotencyKey required", 400);
  }

  const ctx = cmd.authContext;

  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const opp = await tx.opportunity.findUniqueOrThrow({
      where: { id: cmd.opportunityId },
    });

    const assignment = await tx.userCompanyRole.findFirst({
      where: { userId: ctx.userId, companyId: ctx.companyId, status: "active" },
    });
    if (!assignment) {
      throw new DealWorkflowError("NO_ASSIGNMENT", "No active same-company assignment found", 403);
    }

    // Check Qualification BANT-TF-v1
    const qual = await tx.dealQualification.findFirst({
      where: { opportunityId: opp.id, passed: true },
      orderBy: { qualifiedAt: "desc" },
    });
    if (!qual) {
      throw new DealWorkflowError("QUALIFICATION_REQUIRED", "Opportunity qualification (bant-tf-v1) is required before workflow start", 409);
    }

    // Existing run check
    const existingRun = await tx.commandRun.findFirst({
      where: { projectId: ctx.projectId, sourceEntityId: opp.id },
    });
    if (existingRun) {
      const gatesRes = await evaluateDealWorkflowGatesInternal(tx, ctx, opp.id);
      return {
        runId: existingRun.id,
        opportunityId: opp.id,
        definitionKey: "deal-execution.v1",
        currentStage: opp.stage,
        gates: gatesRes,
        idempotent: true,
      };
    }

    const run = await tx.commandRun.create({
      data: {
        projectId: ctx.projectId,
        commandId: "deal-execution.v1",
        sourceEntityType: "opportunity",
        sourceEntityId: opp.id,
        status: "in_progress",
      },
    });

    const gatesRes = await evaluateDealWorkflowGatesInternal(tx, ctx, opp.id);

    await appendAuditEvent(tx, {
      scope: rlsScope(ctx),
      eventType: "deal_workflow.started",
      actorId: ctx.userId,
      resourceType: "command_run",
      resourceId: run.id,
      details: { opportunityId: opp.id, definitionKey: "deal-execution.v1" },
      idempotencyKey: cmd.idempotencyKey,
    });

    return {
      runId: run.id,
      opportunityId: opp.id,
      definitionKey: "deal-execution.v1",
      currentStage: opp.stage,
      gates: gatesRes,
      idempotent: false,
    };
  });
}

async function evaluateDealWorkflowGatesInternal(
  tx: any,
  ctx: AuthContext,
  opportunityId: string,
): Promise<DealGateStatus[]> {
  const gates: DealGateStatus[] = [];

  // 1. Qualification Gate
  const qual = await tx.dealQualification.findFirst({
    where: { opportunityId, passed: true },
    orderBy: { qualifiedAt: "desc" },
  });
  gates.push({
    gateKey: "qualification",
    eligible: !!qual,
    blocker: qual ? undefined : "Passing BANT-TF qualification required",
  });

  // 2. Registration Gate
  const reg = await tx.dealRegistration.findFirst({
    where: { opportunityId, status: "approved" },
  });
  gates.push({
    gateKey: "registration",
    eligible: !!reg,
    blocker: reg ? undefined : "Approved Deal Registration required",
  });

  // 3. PoC Requirements Gate (AC-V31-BIZOPS-03)
  const poc = await tx.pocProject.findFirst({
    where: { opportunityId },
  });
  let pocEligible = false;
  let pocBlocker: string | undefined;
  if (!poc) {
    pocEligible = false;
    pocBlocker = "No linked PoC Project found";
  } else {
    const reqCount = await tx.pocRequirement.count({
      where: { pocProjectId: poc.id },
    });
    if (reqCount === 0) {
      pocEligible = false;
      pocBlocker = "PoC Project requirementRows is empty (POC_REQUIREMENTS_EMPTY)";
    } else {
      pocEligible = true;
    }
  }
  gates.push({
    gateKey: "poc_requirements",
    eligible: pocEligible,
    blocker: pocBlocker,
  });

  // 4. Commercial Approval & Release Gate (U048 + U055)
  const quote = await tx.quote.findFirst({
    where: { opportunityId },
    orderBy: { version: "desc" },
  });
  let commEligible = false;
  let commBlocker: string | undefined;
  if (!quote) {
    commEligible = false;
    commBlocker = "No Quote found for opportunity";
  } else if (!quote.artifactVersionId || !quote.contentHash) {
    commEligible = false;
    commBlocker = "Quote artifact version is missing";
  } else {
    try {
      const relEval = await requireCurrentAiReleaseEvaluation(tx, "quote.internal_release", quote.artifactVersionId, quote.contentHash);
      commEligible = relEval.eligible;
      commBlocker = relEval.eligible ? undefined : relEval.blockers.join(", ");
    } catch {
      commEligible = false;
      commBlocker = "U055 internal release evaluation not completed";
    }
  }
  gates.push({
    gateKey: "commercial_release",
    eligible: commEligible,
    blocker: commBlocker,
  });

  return gates;
}

export async function evaluateDealWorkflowGates(
  cmd: { authContext: AuthContext; opportunityId: string },
): Promise<{ opportunityId: string; gates: DealGateStatus[] }> {
  const ctx = cmd.authContext;
  return withRlsTransaction(rlsScope(ctx), async (tx) => {
    const gates = await evaluateDealWorkflowGatesInternal(tx, ctx, cmd.opportunityId);
    return { opportunityId: cmd.opportunityId, gates };
  });
}
