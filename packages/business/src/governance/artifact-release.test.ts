import { describe, expect, it, vi } from "vitest";

import {
  ArtifactReleaseError,
  evaluateArtifactRelease,
  resolveLegacyArtifactCompatibility,
} from "./artifact-release";

const caller = {
  userId: "evaluator-1",
  sessionId: "session-1",
  scope: { tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" },
  mfaVerifiedAt: new Date(),
};

function tx(overrides: Record<string, unknown> = {}) {
  const version = { id: "version-1", artifactId: "artifact-1", contentHash: "hash-1", artifact: { id: "artifact-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", currentVersionId: "version-1", currentRevision: 1 } };
  const approval = { id: "approval-1", status: "approved", legacyUnbound: false, tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", action: "release", artifactVersionId: "version-1", artifactHashSnapshot: "hash-1", policyHash: "policy-1", requiredQuorum: 1, expiresAt: new Date(Date.now() + 60_000), currentValidity: { state: "valid", artifactVersionId: "version-1", artifactHashSnapshot: "hash-1", policyHashSnapshot: "policy-1", requiredQuorum: 1, satisfiedQuorum: 1, validUntil: new Date(Date.now() + 60_000) } };
  return {
    artifactVersion: { findUnique: vi.fn().mockResolvedValue(version) },
    approvalRequest: { findUnique: vi.fn().mockResolvedValue(approval) },
    artifact: { findUnique: vi.fn().mockResolvedValue(null) },
    scopeBackfillQuarantine: { findUnique: vi.fn().mockResolvedValue(null) },
    userCompanyRole: { findMany: vi.fn().mockResolvedValue([{ id: "assignment-1", userId: caller.userId, companyId: caller.scope.companyId, role: "security_officer", status: "active", validFrom: null, expiresAt: null, revokedAt: null }]) },
    ...overrides,
  } as any;
}

describe("evaluateArtifactRelease", () => {
  it("is deterministic, read-only, and releases only an exact current approved version", async () => {
    const client = tx();
    const result = await evaluateArtifactRelease({ action: "release", artifactVersionId: "version-1", approvalId: "approval-1" }, caller, client);
    expect(result).toEqual({ releasable: true, reasonCode: "RELEASABLE", artifactId: "artifact-1", artifactVersionId: "version-1", approvalId: "approval-1", revision: 1 });
    expect((client as any).artifactVersion.findUnique).toHaveBeenCalledTimes(1);
    expect((client as any).approvalRequest.findUnique).toHaveBeenCalledTimes(1);
  });

  it("marks a formerly valid approval non-current after a content supersession without changing approval history", async () => {
    const client = tx({ artifactVersion: { findUnique: vi.fn().mockResolvedValue({ id: "version-1", artifactId: "artifact-1", contentHash: "hash-1", artifact: { id: "artifact-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", currentVersionId: "version-2", currentRevision: 2 } }) } });
    await expect(evaluateArtifactRelease({ action: "release", artifactVersionId: "version-1", approvalId: "approval-1" }, caller, client)).resolves.toMatchObject({ releasable: false, reasonCode: "STALE_ARTIFACT_VERSION" });
  });

  it.each([
    ["wrong action", { action: "send", artifactVersionId: "version-1", approvalId: "approval-1" }, "ACTION_MISMATCH"],
    ["wrong hash", { action: "release", artifactVersionId: "version-1", approvalId: "approval-1" }, "HASH_MISMATCH"],
  ])("fails closed for %s", async (_label, input, expected) => {
    const client = expected === "HASH_MISMATCH"
      ? tx({ approvalRequest: { findUnique: vi.fn().mockResolvedValue({ id: "approval-1", status: "approved", legacyUnbound: false, tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", action: "release", artifactVersionId: "version-1", artifactHashSnapshot: "forged-hash", policyHash: "policy-1", requiredQuorum: 1, expiresAt: new Date(Date.now() + 60_000), currentValidity: { state: "valid", artifactVersionId: "version-1", artifactHashSnapshot: "forged-hash", policyHashSnapshot: "policy-1", requiredQuorum: 1, satisfiedQuorum: 1, validUntil: new Date(Date.now() + 60_000) } }) } })
      : tx();
    await expect(evaluateArtifactRelease(input, caller, client)).resolves.toMatchObject({ releasable: false, reasonCode: expected });
  });

  it("does not disclose a foreign-scope version", async () => {
    const client = tx({ artifactVersion: { findUnique: vi.fn().mockResolvedValue({ id: "version-1", artifactId: "artifact-1", contentHash: "hash-1", artifact: { id: "artifact-1", tenantId: "other", companyId: "other", projectId: "other", currentVersionId: "version-1", currentRevision: 1 } }) } });
    await expect(evaluateArtifactRelease({ action: "release", artifactVersionId: "version-1", approvalId: "approval-1" }, caller, client)).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });
});

describe("resolveLegacyArtifactCompatibility", () => {
  it("resolves only an eligible persisted GeneratedDocument/DocumentVersion mapping", async () => {
    const document = { id: "artifact-legacy", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", legacySourceType: "GeneratedDocument", legacySourceId: "doc-1" };
    const version = { id: "version-legacy", artifactId: "artifact-legacy", legacySourceType: "DocumentVersion", legacySourceId: "docv-1", artifact: document };
    const client = tx({ artifact: { findUnique: vi.fn().mockResolvedValue(document) }, artifactVersion: { findUnique: vi.fn().mockResolvedValue(version) } });
    await expect(resolveLegacyArtifactCompatibility({ legacySourceType: "GeneratedDocument", legacySourceId: "doc-1" }, caller, client)).resolves.toEqual({ kind: "mapped", legacySourceType: "GeneratedDocument", legacySourceId: "doc-1", artifactId: "artifact-legacy", artifactVersionId: null });
    await expect(resolveLegacyArtifactCompatibility({ legacySourceType: "DocumentVersion", legacySourceId: "docv-1" }, caller, client)).resolves.toEqual({ kind: "mapped", legacySourceType: "DocumentVersion", legacySourceId: "docv-1", artifactId: "artifact-legacy", artifactVersionId: "version-legacy" });
  });

  it("returns only the persisted quarantine reason with null canonical IDs", async () => {
    const client = tx({ scopeBackfillQuarantine: { findUnique: vi.fn().mockResolvedValue({ reasonCode: "governance_missing_scope" }) } });
    await expect(resolveLegacyArtifactCompatibility({ legacySourceType: "GeneratedDocument", legacySourceId: "quarantined-doc" }, caller, client)).resolves.toEqual({ kind: "quarantined", legacySourceType: "GeneratedDocument", legacySourceId: "quarantined-doc", reasonCode: "governance_missing_scope", artifactId: null, artifactVersionId: null });
  });

  it("fails closed for a forged deterministic-looking ID with no actual mapping and for map/quarantine overlap", async () => {
    await expect(resolveLegacyArtifactCompatibility({ legacySourceType: "GeneratedDocument", legacySourceId: "forged-id" }, caller, tx())).rejects.toBeInstanceOf(ArtifactReleaseError);
    const client = tx({ artifact: { findUnique: vi.fn().mockResolvedValue({ id: "artifact-legacy", legacySourceType: "GeneratedDocument", legacySourceId: "doc-1" }) }, scopeBackfillQuarantine: { findUnique: vi.fn().mockResolvedValue({ reasonCode: "governance_missing_scope" }) } });
    await expect(resolveLegacyArtifactCompatibility({ legacySourceType: "GeneratedDocument", legacySourceId: "doc-1" }, caller, client)).rejects.toMatchObject({ code: "BRIDGE_INTEGRITY" });
  });
});
