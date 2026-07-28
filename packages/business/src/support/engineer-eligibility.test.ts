import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
  prisma: {
    userCompanyRole: { findUnique: vi.fn() },
    engineerSkill: { findMany: vi.fn() },
    engineerCertification: { findMany: vi.fn() },
  },
}));

vi.mock("@sangfor/db", () => ({
  prisma: mocks.prisma,
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

import {
  evaluateEngineerEligibility,
  assignEngineerToEngagement,
} from "./engineer-eligibility";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "sales_manager", permissions: [], product: "portal",
};

describe("U053: engineer-eligibility service unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("evaluates eligibility as false when member is foreign or inactive", async () => {
    mocks.prisma.userCompanyRole.findUnique.mockResolvedValue(null);

    const res = await evaluateEngineerEligibility({
      authContext: CTX,
      engineerMembershipId: "m1",
      now: new Date(),
    });

    expect(res.eligible).toBe(false);
    expect(res.blockers).toContain("INACTIVE_OR_FOREIGN_MEMBERSHIP");
  });

  it("evaluates eligibility as true for active member with valid skills and certs", async () => {
    const now = new Date();
    mocks.prisma.userCompanyRole.findUnique.mockResolvedValue({
      id: "m1", companyId: "c1", status: "active",
    });
    mocks.prisma.engineerSkill.findMany.mockResolvedValue([
      { id: "s1", engineerMembershipId: "m1", status: "active", verifiedAt: now },
    ]);
    mocks.prisma.engineerCertification.findMany.mockResolvedValue([
      {
        id: "cert1", engineerMembershipId: "m1", status: "active", revokedAt: null, expiresAt: null,
        evidence: [{ id: "ev1", verifiedAt: now, revokedAt: null }],
      },
    ]);

    const res = await evaluateEngineerEligibility({
      authContext: CTX,
      engineerMembershipId: "m1",
      now,
    });

    expect(res.eligible).toBe(true);
    expect(res.blockers).toHaveLength(0);
  });
});
