import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

const auditMocks = vi.hoisted(() => ({ appendAuditEvent: vi.fn() }));

vi.mock("./audit-db", () => ({ appendAuditEvent: auditMocks.appendAuditEvent }));

import {
  ArtifactServiceError,
  createArtifactVersion,
  type ArtifactVersionWriter,
} from "./artifact-service";

const caller = {
  userId: "writer-1",
  sessionId: "session-1",
  scope: { tenantId: "tenant-1", companyId: "company-1", projectId: "project-1" },
  mfaVerifiedAt: new Date(),
};

function activeRole() {
  return [{ id: "assignment-1", userId: caller.userId, companyId: caller.scope.companyId, role: "security_officer", status: "active", validFrom: null, expiresAt: null, revokedAt: null }];
}

function tx(overrides: Record<string, unknown> = {}) {
  return {
    artifact: {
      findUnique: vi.fn().mockResolvedValue({ id: "artifact-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", currentVersionId: null, currentRevision: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    artifactVersion: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "version-1", artifactId: "artifact-1", version: 1, contentHash: "server-hash" }),
    },
    userCompanyRole: { findMany: vi.fn().mockResolvedValue(activeRole()) },
    ...overrides,
  } as unknown as Parameters<typeof createArtifactVersion>[2];
}

const input: ArtifactVersionWriter = {
  artifactId: "artifact-1",
  expectedCurrentVersionId: null,
  expectedCurrentRevision: 0,
  content: '{ "body": "first", "title": "proposal" }',
  contentType: "application/json",
  metadata: { source: "unit-test" },
};

describe("createArtifactVersion", () => {
  it("canonicalizes content server-side, inserts an immutable version, and CASes the nullable initial pointer", async () => {
    const client = tx();
    auditMocks.appendAuditEvent.mockResolvedValueOnce({ id: "audit-1" });

    const result = await createArtifactVersion(input, caller, client);

    expect(result).toMatchObject({ artifactId: "artifact-1", versionId: "version-1", revision: 1, idempotent: false });
    const create = (client as any).artifactVersion.create.mock.calls[0][0];
    expect(create.data.contentJson).toEqual({ body: "first", title: "proposal" });
    expect(create.data.contentHash).toBe(createHash("sha256").update(create.data.canonicalContentEnvelope, "utf8").digest("hex"));
    expect((client as any).artifact.updateMany).toHaveBeenCalledWith({
      where: { id: "artifact-1", currentVersionId: null, currentRevision: 0 },
      data: { currentVersionId: "version-1", currentRevision: 1 },
    });
    expect(auditMocks.appendAuditEvent).toHaveBeenCalledWith(client, expect.objectContaining({ eventType: "artifact.version.created", resourceId: "version-1" }));
  });

  it("returns the existing exact current version as an idempotent no-op and never inserts history twice", async () => {
    const canonicalHash = createHash("sha256").update('{"contract":"sangfor.artifact-content","payload":{"body":"first","title":"proposal"},"version":1}', "utf8").digest("hex");
    const client = tx({
      artifact: {
        findUnique: vi.fn().mockResolvedValue({ id: "artifact-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", currentVersionId: "version-1", currentRevision: 1 }),
        updateMany: vi.fn(),
      },
      artifactVersion: {
        findUnique: vi.fn().mockResolvedValue({ id: "version-1", artifactId: "artifact-1", version: 1, contentHash: canonicalHash }),
        create: vi.fn(),
      },
    });

    const result = await createArtifactVersion({ ...input, expectedCurrentVersionId: "version-1", expectedCurrentRevision: 1 }, caller, client);

    expect(result).toMatchObject({ versionId: "version-1", revision: 1, idempotent: true });
    expect((client as any).artifactVersion.create).not.toHaveBeenCalled();
    expect((client as any).artifact.updateMany).not.toHaveBeenCalled();
  });

  it("returns a stable 409 instead of silently rebasing a stale writer", async () => {
    const client = tx({ artifact: { findUnique: vi.fn().mockResolvedValue({ id: "artifact-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", currentVersionId: "version-live", currentRevision: 2 }), updateMany: vi.fn() } });

    await expect(createArtifactVersion(input, caller, client)).rejects.toMatchObject({ code: "STALE_CURRENT", httpStatus: 409 });
  });

  it("surfaces an audit failure so the caller transaction rolls back pointer and version together", async () => {
    const client = tx();
    auditMocks.appendAuditEvent.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(createArtifactVersion(input, caller, client)).rejects.toThrow("audit unavailable");
    expect((client as any).artifact.updateMany).toHaveBeenCalledTimes(1);
  });

  it("maps a lost pointer CAS to a stable conflict after inserting no authoritative new current version", async () => {
    const client = tx({ artifact: { findUnique: vi.fn().mockResolvedValue({ id: "artifact-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", currentVersionId: null, currentRevision: 0 }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } });

    await expect(createArtifactVersion(input, caller, client)).rejects.toBeInstanceOf(ArtifactServiceError);
    await expect(createArtifactVersion(input, caller, client)).rejects.toMatchObject({ code: "STALE_CURRENT", httpStatus: 409 });
  });
});
