import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scoped = vi.hoisted(() => ({
  candidateFindFirst: vi.fn(),
  candidateFindMany: vi.fn(),
  documentFindFirst: vi.fn(),
  policyMemoryFindMany: vi.fn(),
}));

vi.mock("@sangfor/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/db")>();
  return {
    ...actual,
    withRlsTransaction: vi.fn(async (_ctx, callback) =>
      callback({
        mailDerivedCandidate: {
          findFirst: scoped.candidateFindFirst,
          findMany: scoped.candidateFindMany,
        },
        knowledgeDocument: { findFirst: scoped.documentFindFirst },
        policyMemory: { findMany: scoped.policyMemoryFindMany },
      }),
    ),
  };
});

import { parseMailGroundTruthManifest } from "./mail-ground-truth";
import {
  dryRunMailGroundTruthReclassification,
  getScopedMailCandidateGroundTruthPreview,
  importMailGroundTruth,
  revertMailGroundTruthImport,
} from "./mail-ground-truth-store";

const SALES = {
  userId: "user-1",
  sessionId: "session-1",
  tenantId: "tenant-1",
  companyId: "company-1",
  projectId: "project-1",
  businessRole: "sales_manager",
  permissions: ["customer.read"],
  product: "portal",
} satisfies AuthContext;

const manifest = parseMailGroundTruthManifest({
  schemaVersion: 1,
  manifestId: "test-v1",
  projectSlug: "demo-project",
  sources: [
    {
      artifactId: "evidence-1",
      fileName: "evidence.xlsx",
      sha256: "b".repeat(64),
      sourceType: "sales_tax_invoice",
    },
  ],
  entities: [
    {
      entityKey: "partner",
      canonicalName: "Partner",
      aliases: [],
      reviewStatus: "approved",
    },
  ],
  relationships: [
    {
      relationshipKey: "project:partner",
      businessProject: "Project",
      subjectEntityKey: "partner",
      role: "channel_partner",
      lifecycle: "completed",
      evidenceTier: "A",
      confidence: 95,
      reviewStatus: "approved",
      sourceArtifactIds: ["evidence-1"],
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  scoped.candidateFindFirst.mockResolvedValue({
    id: "candidate-1",
    candidateType: "customer",
    title: "Partner",
    summary: "Project",
    sourceSender: "sales@example.com",
    mailInsightThreadId: "thread-1",
    knowledgeDocumentId: null,
    mailInsightThread: { projectId: SALES.projectId },
  });
  scoped.candidateFindMany.mockResolvedValue([
    {
      id: "candidate-1",
      candidateType: "customer",
      title: "Partner",
      summary: "Project",
      sourceSender: "sales@example.com",
    },
  ]);
  scoped.policyMemoryFindMany.mockResolvedValue([]);
});

describe("importMailGroundTruth", () => {
  it("prevents writes by default", async () => {
    // Given
    const writes: string[] = [];
    const store = {
      findExisting: async () => [],
      applyBatch: async (
        _projectId: string,
        memories: readonly { readonly key: string }[],
      ) => {
        writes.push(...memories.map((memory) => memory.key));
      },
      revertBySource: async () => 0,
    };
    // When
    const report = await importMailGroundTruth(manifest, {
      projectId: "project-1",
      store,
    });

    // Then
    expect(report.dryRun).toBe(true);
    expect(report.create).toHaveLength(1);
    expect(report.applied).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("applies only the planned create or update rows when explicitly enabled", async () => {
    // Given
    const batches: string[][] = [];
    const store = {
      findExisting: async () => [],
      applyBatch: async (
        _projectId: string,
        memories: readonly { readonly key: string }[],
      ) => {
        batches.push(memories.map((memory) => memory.key));
      },
      revertBySource: async () => 0,
    };
    // When
    const report = await importMailGroundTruth(manifest, {
      dryRun: false,
      projectId: "project-1",
      store,
    });

    // Then
    expect(report.applied).toBe(1);
    expect(batches).toEqual([["test-v1:project:partner"]]);
  });
});

describe("dryRunMailGroundTruthReclassification", () => {
  it("reads only project-scoped candidates and returns a no-write plan", async () => {
    // Given
    const requestedProjects: string[] = [];
    const store = {
      findCandidates: async (projectId: string) => {
        requestedProjects.push(projectId);
        return [
          {
            id: "candidate-1",
            candidateType: "customer",
            title: "Partner",
            summary: "Project",
            sourceSender: "sales@example.com",
          },
        ];
      },
    };
    const groundTruthStore = {
      findExisting: async () => [],
      applyBatch: async () => {
        throw new Error("dry-run must not write");
      },
      revertBySource: async () => {
        throw new Error("dry-run must not revert");
      },
    };

    // When
    const report = await dryRunMailGroundTruthReclassification(manifest, {
      projectId: "project-1",
      store,
      groundTruthStore,
    });

    // Then
    expect(requestedProjects).toEqual(["project-1"]);
    expect(report.scanned).toBe(1);
    expect(report.changes).toEqual([
      {
        id: "candidate-1",
        title: "Partner",
        from: "customer",
        to: "partner",
        entityKey: "partner",
        relationshipKeys: ["project:partner"],
        evidence: [
          {
            relationshipKey: "project:partner",
            businessProject: "Project",
            role: "channel_partner",
            evidenceTier: "A",
            sourceArtifactIds: ["evidence-1"],
          },
        ],
      },
    ]);
    expect(report.writeOperationsPrevented).toBe(1);
    expect(report.importPlan.create).toHaveLength(1);
    expect(report.writesPerformed).toBe(0);
  });
});

describe("getScopedMailCandidateGroundTruthPreview", () => {
  it("runs candidate, backlog, and memory reads inside one scoped transaction", async () => {
    const report = await getScopedMailCandidateGroundTruthPreview(
      SALES,
      "candidate-1",
      manifest,
    );

    expect(report).toMatchObject({
      scanned: 1,
      writeOperationsPrevented: 1,
      writesPerformed: 0,
    });
    expect(scoped.candidateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "candidate-1" } }),
    );
    expect(scoped.candidateFindMany).toHaveBeenCalled();
    expect(scoped.policyMemoryFindMany).toHaveBeenCalled();
  });

  it("returns null without reading the backlog for a foreign candidate", async () => {
    scoped.candidateFindFirst.mockResolvedValueOnce(null);

    const report = await getScopedMailCandidateGroundTruthPreview(
      SALES,
      "foreign",
      manifest,
    );

    expect(report).toBeNull();
    expect(scoped.candidateFindMany).not.toHaveBeenCalled();
    expect(scoped.policyMemoryFindMany).not.toHaveBeenCalled();
  });

  it("returns zero counts for an empty scoped backlog", async () => {
    scoped.candidateFindMany.mockResolvedValueOnce([]);

    const report = await getScopedMailCandidateGroundTruthPreview(
      SALES,
      "candidate-1",
      manifest,
    );

    expect(report).toMatchObject({
      scanned: 0,
      changes: [],
      humanReview: [],
      writeOperationsPrevented: 0,
      writesPerformed: 0,
    });
  });
});

describe("revertMailGroundTruthImport", () => {
  it("reports rollback without changing memories by default", async () => {
    // Given
    const calls: string[] = [];
    const store = {
      findExisting: async () => [
        {
          key: "test-v1:project:partner",
          label: "Partner",
          valueJson: {},
          source: "ground_truth_manifest:test-v1",
          confidence: 95,
          status: "active",
        },
      ],
      applyBatch: async () => undefined,
      revertBySource: async (_projectId: string, source: string) => {
        calls.push(source);
        return 1;
      },
    };

    // When
    const report = await revertMailGroundTruthImport("test-v1", {
      projectId: "project-1",
      store,
    });

    // Then
    expect(report).toEqual({
      source: "ground_truth_manifest:test-v1",
      dryRun: true,
      matched: 1,
      reverted: 0,
    });
    expect(calls).toHaveLength(0);
  });
});
