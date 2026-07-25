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

vi.mock("./audit-db", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

import { createArtifactAccessEvent, issueDataExport, ArtifactAccessError } from "./artifact-access";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "security_officer", permissions: [], product: "portal",
};

describe("U058: artifact-access unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createArtifactAccessEvent creates exact view allowed event via tx", async () => {
    const tx = {
      artifactAccessEvent: { create: vi.fn(async () => ({ id: "ev1" })) },
    };
    const result: any = await createArtifactAccessEvent(tx, {
      artifactId: "art1", artifactVersionId: "av1", actorAssignmentId: "asgn1",
      requestId: "req1", createdAt: new Date(),
      accessType: "view", policyResult: "allowed", watermarkApplied: true,
      redactionApplied: false, denialReason: null,
      requestMetadata: { schemaVersion: "artifact-access-event/v1", routeAction: "artifact.view" },
    });
    expect(result.id).toBe("ev1");
    expect(tx.artifactAccessEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accessType: "view", policyResult: "allowed" }) }),
    );
  });

  it("issueDataExport generates exp1. capability and returns it once", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        artifactAccessEvent: { create: vi.fn(async () => ({ id: "ev-exp1" })) },
        dataExportRequest: { create: vi.fn(async () => ({ id: "exp1", status: "issued" })) },
        exportCapability: { create: vi.fn(async () => ({ id: "cap1" })) },
      };
      mocks.appendAuditEvent.mockResolvedValue({ id: "audit1" });
      return cb(tx);
    });

    const result: any = await issueDataExport({
      authContext: CTX,
      artifactId: "art1",
      artifactVersionId: "av1",
      artifactContentHash: "a".repeat(64),
      approvalId: "apr1",
      purpose: "legal review",
      idempotencyKey: "k-export-1",
      requestId: "req1",
      now: new Date(),
    });

    expect(result.capability).toMatch(/^exp1\./);
    expect(result.capability.length).toBe(48); // "exp1." (5) + 43 chars
    expect(result.status).toBe("issued");
    expect(result.exportId).toBe("exp1");
  });
});
