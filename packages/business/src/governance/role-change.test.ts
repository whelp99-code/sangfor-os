import { beforeEach, describe, expect, it, vi } from "vitest";

const kernel = vi.hoisted(() => ({ decide: vi.fn(), submit: vi.fn() }));
const release = vi.hoisted(() => ({ evaluate: vi.fn() }));
const audit = vi.hoisted(() => ({ append: vi.fn() }));
vi.mock("./approval-kernel", () => ({ decideApprovalWithClient: kernel.decide, submitApprovalRequest: kernel.submit }));
vi.mock("./artifact-release", () => ({ evaluateArtifactRelease: release.evaluate }));
vi.mock("./audit-db", () => ({ appendAuditEvent: audit.append }));

import {
  RoleChangeError,
  canonicalRoleChangeRequestInputHash,
  decideRoleChange,
  validateRoleChangeRequestInput,
} from "./role-change";

describe("U024 role-change request boundary — RED before implementation", () => {
  const canonical = {
    companyId: "company-1",
    requestedByAssignmentId: "assignment-requester",
    targetMembershipId: "assignment-target",
    toRole: "security_officer",
    reason: "separate privileged duties",
    expectedMembershipRevision: 0,
  };

  it("accepts only the exact request shape and produces a server-owned idempotency hash", () => {
    expect(validateRoleChangeRequestInput({
      targetMembershipId: canonical.targetMembershipId,
      toRole: canonical.toRole,
      reason: canonical.reason,
      expectedMembershipRevision: canonical.expectedMembershipRevision,
    })).toEqual(expect.objectContaining({ toRole: "security_officer" }));
    expect(canonicalRoleChangeRequestInputHash(canonical)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    {},
    { targetMembershipId: "assignment-target", toRole: "owner", reason: "x", expectedMembershipRevision: 0 },
    { targetMembershipId: "assignment-target", toRole: "security_officer", reason: "x", expectedMembershipRevision: -1 },
    { targetMembershipId: "assignment-target", toRole: "security_officer", reason: "x", expectedMembershipRevision: 0, companyId: "forged" },
  ])("fails closed for malformed, unknown-role, stale, and forged request input %#", (input) => {
    expect(() => validateRoleChangeRequestInput(input)).toThrow(RoleChangeError);
  });
});

const caller = { userId: "approver-a", sessionId: "mfa-session-a", scope: { tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" }, mfaVerifiedAt: new Date() };
const roleRequest = { id: "role-change-1", companyId: "company-1", approvalRequestId: "approval-1", status: "pending_approval", legacyUnbound: false, requestedByAssignmentId: "requester-assignment", targetMembershipId: "target-assignment", targetMembershipId2: "target-assignment", expectedMembershipRevision: 0, artifactVersionId: "version-1", snapshotHash: "a".repeat(64), toRole: "security_officer", expiresAt: new Date(Date.now() + 60_000), revision: 0 };

function decisionTx(overrides: Record<string, unknown> = {}) {
  return {
    userCompanyRole: {
      findMany: vi.fn().mockResolvedValue([{ id: "approver-assignment", userId: "approver-a", companyId: "company-1", role: "security_officer", status: "active", validFrom: null, expiresAt: null, revokedAt: null }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    roleChangeRequest: { findFirst: vi.fn().mockResolvedValue(roleRequest), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ ...roleRequest, status: "applied", revision: 1 }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  } as any;
}

describe("two-person MFA governed decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audit.append.mockResolvedValue({ id: "audit" });
  });

  it("leaves the role-change row byte-for-byte pending after the first eligible MFA approver", async () => {
    const tx = decisionTx();
    kernel.decide.mockResolvedValue({ outcome: "recorded_nonterminal", request: { id: "approval-1", status: "ready_for_human_approval", revision: 2 }, decision: { id: "decision-1", sequence: 1 }, validity: {} });

    const result = await decideRoleChange({ roleChangeRequestId: "role-change-1", approvalId: "approval-1", decision: "approve", expectedRevision: 1 }, caller, tx);

    expect(result.outcome).toBe("recorded_nonterminal");
    expect(tx.roleChangeRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.userCompanyRole.updateMany).not.toHaveBeenCalled();
  });

  it("applies exactly once only after the final distinct MFA-verified role.manage approver", async () => {
    const tx = decisionTx();
    kernel.decide.mockResolvedValue({ outcome: "approved", request: { id: "approval-1", status: "approved", revision: 3 }, decision: { id: "decision-2", sequence: 2 }, validity: {} });
    release.evaluate.mockResolvedValue({ releasable: true, reasonCode: "RELEASABLE" });

    await decideRoleChange({ roleChangeRequestId: "role-change-1", approvalId: "approval-1", decision: "approve", expectedRevision: 2 }, caller, tx);

    expect(tx.userCompanyRole.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ revision: 0, status: "active" }), data: expect.objectContaining({ revision: 1, role: "security_officer" }) }));
    expect(tx.roleChangeRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "pending_approval", revision: 0 }), data: expect.objectContaining({ status: "applied", revision: 1, appliedDecisionSequence: 2 }) }));
  });

  it("rejects missing MFA, requester/target approvers, and duplicate approvers before a membership write", async () => {
    const tx = decisionTx();
    await expect(decideRoleChange({ roleChangeRequestId: "role-change-1", approvalId: "approval-1", decision: "approve", expectedRevision: 1 }, { ...caller, mfaVerifiedAt: null }, tx)).rejects.toMatchObject({ code: "ROLE_CHANGE_FORBIDDEN" });
    const requesterTx = decisionTx({ userCompanyRole: { findMany: vi.fn().mockResolvedValue([{ id: "requester-assignment", userId: "approver-a", companyId: "company-1", role: "security_officer", status: "active", validFrom: null, expiresAt: null, revokedAt: null }]), updateMany: vi.fn() } });
    await expect(decideRoleChange({ roleChangeRequestId: "role-change-1", approvalId: "approval-1", decision: "approve", expectedRevision: 1 }, caller, requesterTx)).rejects.toMatchObject({ code: "ROLE_CHANGE_POLICY_INVALID" });
    expect(requesterTx.userCompanyRole.updateMany).not.toHaveBeenCalled();
    kernel.decide.mockRejectedValueOnce({ code: "DUPLICATE_APPROVER" });
    await expect(decideRoleChange({ roleChangeRequestId: "role-change-1", approvalId: "approval-1", decision: "approve", expectedRevision: 1 }, caller, tx)).rejects.toMatchObject({ code: "ROLE_CHANGE_DUPLICATE_APPROVER" });
  });
});
