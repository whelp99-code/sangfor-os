import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: mocks.canonicalizeRfc8785,
}));

vi.mock("./audit-db", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

import { scanOwnerTuples, computePreviewHash, createOwnershipTransfer, OwnershipTransferError } from "./ownership-transfer";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "security_officer", permissions: [], product: "portal",
};

const makeTx = (overrides?: Record<string, unknown>) => ({
  artifact: { findMany: vi.fn(async () => []) },
  approvalRequest: { findMany: vi.fn(async () => []) },
  opportunity: { findMany: vi.fn(async () => []) },
  workTask: { findMany: vi.fn(async () => []) },
  vendorRequest: { findMany: vi.fn(async () => []) },
  renewalOpportunity: { findMany: vi.fn(async () => []) },
  supportCase: { findMany: vi.fn(async () => []) },
  roleChangeRequest: {
    findUniqueOrThrow: vi.fn(async () => ({
      id: "rcr1", targetMembershipId: "src1", expectedMembershipRevision: 0,
      approvalRequest: { id: "apr1", revision: 0 },
    })),
  },
  ownershipTransfer: { create: vi.fn(async () => ({ id: "ot1", status: "requested", revision: 0 })) },
  ...overrides,
});

describe("U059: ownership-transfer unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scanOwnerTuples returns empty array when source owns nothing", async () => {
    const tx = makeTx();
    const tuples = await scanOwnerTuples(tx, "src1");
    expect(tuples).toHaveLength(0);
  });

  it("scanOwnerTuples sorts by (entityType, entityId) in UTF-16 order", async () => {
    const tx = makeTx({
      artifact: { findMany: vi.fn(async () => [{ id: "b", ownerAssignmentId: "src1", ownershipRevision: 0 }, { id: "a", ownerAssignmentId: "src1", ownershipRevision: 1 }]) },
    });
    const tuples = await scanOwnerTuples(tx, "src1");
    expect(tuples[0]!.entityId).toBe("a");
    expect(tuples[1]!.entityId).toBe("b");
  });

  it("computePreviewHash is deterministic for empty array", () => {
    const h1 = computePreviewHash([]);
    const h2 = computePreviewHash([]);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("createOwnershipTransfer throws OWNERSHIP_TRANSFER_NOT_REQUIRED when no owners", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      return cb(makeTx());
    });

    await expect(createOwnershipTransfer({
      authContext: CTX,
      roleChangeRequestId: "rcr1",
      successorAssignmentId: "succ1",
      previewHash: "a".repeat(64),
      idempotencyKey: "k1",
      now: new Date(),
    })).rejects.toThrow(OwnershipTransferError);
  });

  it("createOwnershipTransfer throws OWNERSHIP_PREVIEW_STALE when hash mismatch", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTx({
        artifact: { findMany: vi.fn(async () => [{ id: "art1", ownerAssignmentId: "src1", ownershipRevision: 0 }]) },
      });
      return cb(tx);
    });

    await expect(createOwnershipTransfer({
      authContext: CTX,
      roleChangeRequestId: "rcr1",
      successorAssignmentId: "succ1",
      previewHash: "wrong".padEnd(64, "0"),
      idempotencyKey: "k1",
      now: new Date(),
    })).rejects.toThrow(OwnershipTransferError);
  });
});
