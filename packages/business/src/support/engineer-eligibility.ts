import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";

export class EngineerEligibilityError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "EngineerEligibilityError";
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

export type EvaluateEngineerEligibilityInput = {
  authContext: AuthContext;
  engineerMembershipId: string;
  productFamilyId?: string;
  capabilityKey?: string;
  now: Date;
};

export type EvaluateEngineerEligibilityResult = {
  eligible: boolean;
  blockers: string[];
};

export async function evaluateEngineerEligibility(
  input: EvaluateEngineerEligibilityInput,
): Promise<EvaluateEngineerEligibilityResult> {
  const { prisma } = await import("@sangfor/db");
  const { authContext, engineerMembershipId, productFamilyId, capabilityKey, now } = input;
  const blockers: string[] = [];

  const member = await prisma.userCompanyRole.findUnique({
    where: { id: engineerMembershipId },
  });

  if (!member || member.companyId !== authContext.companyId || member.status !== "active") {
    blockers.push("INACTIVE_OR_FOREIGN_MEMBERSHIP");
    return { eligible: false, blockers };
  }

  // Evaluate skills
  const skills = await prisma.engineerSkill.findMany({
    where: {
      engineerMembershipId,
      status: "active",
      verifiedAt: { lte: now },
      ...(productFamilyId ? { productFamilyId } : {}),
      ...(capabilityKey ? { capabilityKey } : {}),
    },
  });

  if (skills.length === 0 && (productFamilyId || capabilityKey)) {
    blockers.push("MISSING_REQUIRED_SKILL");
  }

  // Evaluate certifications
  const certs = await prisma.engineerCertification.findMany({
    where: {
      engineerMembershipId,
      status: "active",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: {
      evidence: {
        where: {
          revokedAt: null,
          verifiedAt: { lte: now },
        },
      },
    },
  });

  const validCerts = certs.filter((c) => c.evidence.length > 0);
  if (certs.length > 0 && validCerts.length === 0) {
    blockers.push("CERTIFICATION_EVIDENCE_REVOKED_OR_UNVERIFIED");
  }

  const eligible = blockers.length === 0;
  return { eligible, blockers };
}

export type AssignEngineerCommand = {
  authContext: AuthContext;
  engagementId: string;
  requirementId: string;
  engineerMembershipId: string;
  expectedRequirementSnapshotHash: string;
  idempotencyKey: string;
  now: Date;
};

export async function assignEngineerToEngagement(cmd: AssignEngineerCommand) {
  const { authContext, engagementId, requirementId, engineerMembershipId, expectedRequirementSnapshotHash, idempotencyKey, now } = cmd;

  if (!engagementId || !requirementId || !engineerMembershipId || !idempotencyKey) {
    throw new EngineerEligibilityError("INVALID_COMMAND", "Missing required fields", 400);
  }

  const evalRes = await evaluateEngineerEligibility({
    authContext,
    engineerMembershipId,
    now,
  });

  if (!evalRes.eligible) {
    throw new EngineerEligibilityError("ENGINEER_INELIGIBLE", `Engineer ineligible: ${evalRes.blockers.join(", ")}`, 422);
  }

  return withRlsTransaction(rlsScope(authContext), async (tx) => {
    const callerAssignment = await tx.userCompanyRole.findFirst({
      where: { userId: authContext.userId, companyId: authContext.companyId, status: "active" },
      select: { id: true },
    });
    if (!callerAssignment) {
      throw new EngineerEligibilityError("NO_ASSIGNMENT", "No active same-company caller assignment found", 403);
    }
    const existing = await tx.engineerAssignment.findFirst({
      where: { requirementId, engineerMembershipId, status: "active" },
    });

    if (existing) {
      return existing;
    }

    const snapshotObj = { eligible: true, evaluatedAt: now.toISOString() };
    const snapshotHash = sha256Hex(canonicalizeRfc8785(snapshotObj));

    const assignment = await tx.engineerAssignment.create({
      data: {
        requirementId,
        engineerMembershipId,
        assignedByAssignmentId: callerAssignment.id,
        status: "active",
        eligibilitySnapshotJson: snapshotObj,
        eligibilitySnapshotHash: snapshotHash,
        assignedAt: now,
      },
    });

    const inputHash = sha256Hex(canonicalizeRfc8785({
      schemaVersion: "engineer-assignment/v1",
      engagementId,
      requirementId,
      engineerMembershipId,
      expectedRequirementSnapshotHash,
      idempotencyKey,
    }));

    await appendAuditEvent(tx, {
      scope: rlsScope(authContext),
      eventType: "delivery.engineer_assigned",
      actorId: authContext.userId,
      resourceType: "engineer_assignment",
      resourceId: assignment.id,
      details: { inputHash, engagementId, requirementId, engineerMembershipId },
      idempotencyKey,
    });

    return assignment;
  });
}
