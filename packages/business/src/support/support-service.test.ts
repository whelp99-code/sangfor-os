import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
  prisma: {
    customerAsset: { findUnique: vi.fn() },
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

import { createSupportCase, transitionSupportCaseStatus } from "./support-service";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "sales_manager", permissions: [], product: "portal",
};

describe("U056: support-service unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates support case and snapshots SLA", async () => {
    const openedAt = new Date();
    mocks.prisma.customerAsset.findUnique.mockResolvedValue({
      id: "ast1", customerId: "cust1",
    });

    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        supportCase: {
          findFirst: vi.fn(async () => null),
          create: vi.fn(async () => ({ id: "sc1", status: "open", revision: 0 })),
        },
        supportCaseSlaSnapshot: {
          create: vi.fn(async () => ({ id: "snap1" })),
        },
        supportSlaPolicyVersion: {
          findFirst: vi.fn(async () => ({ id: "pol-v1" })),
        },
      };
      return cb(tx);
    });

    const res = await createSupportCase({
      authContext: CTX,
      assetId: "ast1",
      subject: "Firewall Connection Issue",
      severity: "critical",
      ownerAssignmentId: "ucr1",
      idempotencyKey: "k1",
      openedAt,
    });

    expect(res.id).toBe("sc1");
    expect(res.status).toBe("open");
  });

  it("transitions support case status from open to in_progress on respond", async () => {
    const now = new Date();
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        supportCase: {
          findUniqueOrThrow: vi.fn(async () => ({ id: "sc1", status: "open", revision: 0, respondedAt: null })),
          update: vi.fn(async () => ({ id: "sc1", status: "in_progress", revision: 1, respondedAt: now })),
        },
      };
      return cb(tx);
    });

    const res = await transitionSupportCaseStatus({
      authContext: CTX,
      supportCaseId: "sc1",
      action: "respond",
      expectedRevision: 0,
      idempotencyKey: "k-resp-1",
      now,
    });

    expect(res.status).toBe("in_progress");
  });
});
