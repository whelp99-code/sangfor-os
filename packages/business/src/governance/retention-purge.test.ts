import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
  canonicalizeRfc8785: (value: unknown) => JSON.stringify(value),
}));

vi.mock("@sangfor/db", () => ({
  Prisma: { sql: vi.fn((parts: TemplateStringsArray) => parts.join("?")) },
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: mocks.canonicalizeRfc8785,
}));

vi.mock("./audit-db", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

import type { AuthContext } from "@sangfor/auth";
import { executeRetentionRun, RetentionServiceError } from "./retention-purge";

const NOW = new Date("2026-07-26T00:00:00.000Z");
const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "security_officer", permissions: [], product: "portal",
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildTx() {
  const chunk = {
    id: "chunk1",
    documentId: "doc1",
    content: "retained content",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    document: { projectId: "p1" },
  };
  const preActionHash = sha256(JSON.stringify({
    resourceKind: "knowledge_chunk",
    id: chunk.id,
    documentId: chunk.documentId,
    projectId: chunk.document.projectId,
    createdAt: chunk.createdAt.toISOString(),
    content: chunk.content,
  }));
  const preview = {
    id: "run1",
    companyId: "c1",
    phase: "preview",
    status: "completed",
    revision: 0,
    retentionAssignmentId: "ra1",
    policyVersionId: "pv1",
    policyContentHash: "b".repeat(64),
    resourceKind: "knowledge_chunk",
    action: "purge",
    cutoffAt: NOW,
    maxItems: 10,
    previewHash: "a".repeat(64),
    retentionAssignment: { active: true, dueAt: new Date("2026-01-01T00:00:00.000Z") },
    items: [{
      ordinal: 0,
      resourceKind: "knowledge_chunk",
      resourceId: "chunk1",
      documentId: "doc1",
      projectId: "p1",
      policyVersionId: "pv1",
      policyContentHash: "b".repeat(64),
      preActionHash,
      holdSetHash: sha256(JSON.stringify([])),
      decision: "candidate",
    }],
  };
  const tx = {
    $executeRaw: vi.fn(),
    userCompanyRole: { findFirst: vi.fn(async () => ({ id: "assignment1" })) },
    retentionRun: {
      findFirst: vi.fn(async (args: any) => args.where.phase === "execution" ? null : preview),
      create: vi.fn(async () => ({ id: "execution1" })),
    },
    approvalRequest: {
      findFirst: vi.fn(async () => ({
        id: "apr1",
        companyId: "c1",
        projectId: "p1",
        legacyUnbound: false,
        status: "approved",
        action: "retention.purge",
        revision: 2,
        artifactVersionId: "manifest1",
        artifactHashSnapshot: "c".repeat(64),
        policyHash: "d".repeat(64),
        currentValidity: {
          state: "valid",
          requestRevision: 2,
          validUntil: new Date("2026-07-27T00:00:00.000Z"),
          artifactVersionId: "manifest1",
          artifactHashSnapshot: "c".repeat(64),
          policyHashSnapshot: "d".repeat(64),
        },
        artifactVersion: {
          id: "manifest1",
          contentHash: "c".repeat(64),
          contentJson: { previewRunId: "run1", previewHash: "a".repeat(64) },
        },
      })),
    },
    legalHoldScope: { findMany: vi.fn(async () => []) },
    knowledgeChunk: {
      findFirst: vi.fn(async () => chunk),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return tx;
}

describe("U058: retention-purge unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["RETENTION_LOCAL_PURGE_ALLOWED"];
    delete process.env["RETENTION_U009_RECEIPT_SHA256"];
    mocks.appendAuditEvent.mockResolvedValue({ id: "audit1" });
  });

  it("fails closed when a server-derived RLS context is absent", async () => {
    await expect(executeRetentionRun({
      previewRunId: "run1", approvalId: "apr1", previewHash: "a".repeat(64),
      dryRun: true, actorId: "u1", now: NOW,
    })).rejects.toMatchObject({ code: "RETENTION_AUTH_CONTEXT_REQUIRED" });
    expect(mocks.withRlsTransaction).not.toHaveBeenCalled();
  });

  it("rejects destructive execution without both local and U009 guards", async () => {
    await expect(executeRetentionRun({
      previewRunId: "run1", approvalId: "apr1", previewHash: "a".repeat(64),
      dryRun: false, authContext: CTX, actorId: "u1", now: NOW,
    })).rejects.toBeInstanceOf(RetentionServiceError);

    process.env["RETENTION_LOCAL_PURGE_ALLOWED"] = "1";
    await expect(executeRetentionRun({
      previewRunId: "run1", approvalId: "apr1", previewHash: "a".repeat(64),
      dryRun: false, authContext: CTX, actorId: "u1", now: NOW,
    })).rejects.toMatchObject({ code: "RETENTION_U009_RECEIPT_REQUIRED" });
    expect(mocks.withRlsTransaction).not.toHaveBeenCalled();
  });

  it("persists an approval-backed dry-run receipt in the transaction", async () => {
    const tx = buildTx();
    mocks.withRlsTransaction.mockImplementation(async (_scope, callback) => callback(tx));

    const result = await executeRetentionRun({
      previewRunId: "run1", approvalId: "apr1", previewHash: "a".repeat(64),
      dryRun: true, authContext: CTX, actorId: "u1", now: NOW,
    });

    expect(result).toEqual({ status: "completed", purgedCount: 0, wouldPurgeCount: 1 });
    expect(tx.knowledgeChunk.deleteMany).not.toHaveBeenCalled();
    expect(tx.retentionRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phase: "execution",
        executionMode: "dry_run",
        approvalRequestId: "apr1",
        wouldPurgeCount: 1,
      }),
    }));
    expect(mocks.appendAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("records a blocked receipt instead of reporting completion after candidate drift", async () => {
    const tx = buildTx();
    tx.knowledgeChunk.findFirst.mockResolvedValueOnce(null as any);
    mocks.withRlsTransaction.mockImplementation(async (_scope, callback) => callback(tx));

    const result = await executeRetentionRun({
      previewRunId: "run1", approvalId: "apr1", previewHash: "a".repeat(64),
      dryRun: true, authContext: CTX, actorId: "u1", now: NOW,
    });

    expect(result).toEqual({ status: "blocked", purgedCount: 0, wouldPurgeCount: 0 });
    expect(tx.retentionRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "blocked", blockedCount: 1 }),
    }));
  });
});
