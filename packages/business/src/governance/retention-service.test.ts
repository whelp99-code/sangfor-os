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

import { previewRetentionRun, RetentionServiceError } from "./retention-service";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "security_officer", permissions: [], product: "portal",
};

describe("U058: retention-service unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-purge policy action", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        retentionAssignment: {
          findUniqueOrThrow: vi.fn(async () => ({
            id: "ra1",
            policyVersionId: "pv1",
            policyVersion: { action: "archive", resourceKind: "knowledge_chunk", contentHash: "h1" },
          })),
        },
      };
      return cb(tx);
    });

    await expect(previewRetentionRun({
      authContext: CTX,
      retentionAssignmentId: "ra1",
      idempotencyKey: "k1",
      now: new Date(),
    })).rejects.toThrow(RetentionServiceError);
  });

  it("rejects non-knowledge_chunk resource kind", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        retentionAssignment: {
          findUniqueOrThrow: vi.fn(async () => ({
            id: "ra1",
            policyVersionId: "pv1",
            policyVersion: { action: "purge", resourceKind: "artifact", contentHash: "h1" },
          })),
        },
      };
      return cb(tx);
    });

    await expect(previewRetentionRun({
      authContext: CTX,
      retentionAssignmentId: "ra1",
      idempotencyKey: "k1",
      now: new Date(),
    })).rejects.toThrow(RetentionServiceError);
  });
});
