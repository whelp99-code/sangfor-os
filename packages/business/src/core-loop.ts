import { prisma } from "@sangfor/db";
import {
  normalizeOpportunityStage,
  validateOpportunityStageOrder,
  validateRegistrationGate,
} from "./opportunity-stage";

export interface ConvertMailToOpportunityInput {
  candidateId: string;
  companyId: string;
  customerId: string;
  title: string;
}

export interface CoreLoopResult {
  opportunityId: string;
  stage: string;
}

export async function convertMailToOpportunity(input: ConvertMailToOpportunityInput): Promise<CoreLoopResult> {
  const candidate = await prisma.mailDerivedCandidate.findUnique({ where: { id: input.candidateId } });
  if (!candidate) throw new Error("Mail candidate not found");
  if (candidate.status !== "approved") throw new Error(`Mail candidate status is ${candidate.status}, not approved`);

  const opportunity = await prisma.opportunity.create({
    data: {
      projectId: input.companyId,
      customerId: input.customerId,
      title: input.title,
      stage: "LEAD",
      probability: 10,
    },
  });

  await prisma.mailDerivedCandidate.update({
    where: { id: input.candidateId },
    data: { status: "converted", createdEntityType: "opportunity", createdEntityId: opportunity.id },
  });

  return { opportunityId: opportunity.id, stage: "LEAD" };
}

export interface AdvanceOpportunityInput {
  opportunityId: string;
  targetStage: string;
}

export async function advanceOpportunity(input: AdvanceOpportunityInput): Promise<CoreLoopResult> {
  const opp = await prisma.opportunity.findUnique({
    where: { id: input.opportunityId },
    include: { dealRegistration: { select: { regStatus: true } } },
  });
  if (!opp) throw new Error("Opportunity not found");

  const targetStage = normalizeOpportunityStage(input.targetStage);

  // Enforce the same guards as the wired advance path (opportunity-center):
  // reject illegal stage skips/regressions and block forward entry into a
  // registration-gated late stage while the deal registration is unresolved.
  // This function is not currently wired to any surface, but keeping the gates
  // here prevents a stage bypass if it is ever routed in the future.
  const order = validateOpportunityStageOrder(opp.stage, targetStage);
  if (!order.allowed) {
    throw new Error(`illegal_stage_transition:${order.reason}`);
  }

  const gate = validateRegistrationGate({
    from: opp.stage,
    to: targetStage,
    dealType: opp.dealType,
    regStatus: opp.dealRegistration?.regStatus ?? null,
  });
  if (!gate.allowed) {
    throw new Error(`registration_gate:${gate.reason}`);
  }

  const updated = await prisma.opportunity.update({
    where: { id: input.opportunityId },
    data: { stage: targetStage },
  });

  return { opportunityId: updated.id, stage: updated.stage };
}

export interface ProcessMailApprovalInput {
  candidateId: string;
  approved: boolean;
  companyId: string;
}

export interface ProcessMailApprovalResult {
  candidateId: string;
  status: string;
}

export async function processMailApproval(input: ProcessMailApprovalInput): Promise<ProcessMailApprovalResult> {
  const candidate = await prisma.mailDerivedCandidate.findUnique({
    where: { id: input.candidateId },
  });
  if (!candidate) throw new Error("Mail candidate not found");

  const newStatus = input.approved ? "approved" : "rejected";
  await prisma.mailDerivedCandidate.update({
    where: { id: input.candidateId },
    data: { status: newStatus },
  });

  if (input.approved && !candidate.createdEntityId) {
    const customer = await prisma.customer.findFirst({ where: { projectId: input.companyId } });
    if (customer) {
      await convertMailToOpportunity({
        candidateId: input.candidateId,
        companyId: input.companyId,
        customerId: customer.id,
        title: candidate.title || candidate.sourceTitle || `Opportunity from ${candidate.sourceSender || "unknown"}`,
      });
    }
  }

  return { candidateId: input.candidateId, status: newStatus };
}
