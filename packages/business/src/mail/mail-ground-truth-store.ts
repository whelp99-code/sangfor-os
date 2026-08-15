import type { AuthContext } from "@sangfor/auth";
import { Prisma, prisma, withRlsTransaction } from "@sangfor/db";

import {
  buildGroundTruthReclassificationPlan,
  type ExistingProjectRoleMemory,
  type GroundTruthCandidate,
  type GroundTruthImportPlan,
  type GroundTruthReclassificationPlan,
  type MailGroundTruthManifest,
} from "./mail-ground-truth";
import { buildGroundTruthImportPlan } from "./mail-ground-truth-import-plan";
import { getScopedMailDerivedCandidateWithClient } from "./candidates-update";

export const PROJECT_ENTITY_ROLE_MEMORY_TYPE = "project_entity_role";

type GroundTruthStore = {
  readonly findExisting: (
    projectId: string,
  ) => Promise<readonly ExistingProjectRoleMemory[]>;
  readonly applyBatch: (
    projectId: string,
    memories: readonly ExistingProjectRoleMemory[],
  ) => Promise<void>;
  readonly revertBySource: (
    projectId: string,
    source: string,
  ) => Promise<number>;
};

type ImportGroundTruthOptions = {
  readonly dryRun?: boolean;
  readonly projectId: string;
  readonly store?: GroundTruthStore;
};

export type GroundTruthImportReport = GroundTruthImportPlan & {
  readonly dryRun: boolean;
  readonly applied: number;
};

type RevertGroundTruthOptions = {
  readonly dryRun?: boolean;
  readonly projectId: string;
  readonly store?: GroundTruthStore;
};

export type GroundTruthRevertReport = {
  readonly source: string;
  readonly dryRun: boolean;
  readonly matched: number;
  readonly reverted: number;
};

type ReclassificationStore = {
  readonly findCandidates: (
    projectId: string,
  ) => Promise<readonly GroundTruthCandidate[]>;
};

type ReclassificationOptions = {
  readonly projectId: string;
  readonly store?: ReclassificationStore;
  readonly groundTruthStore?: GroundTruthStore;
};

export type GroundTruthReclassificationReport =
  GroundTruthReclassificationPlan & {
    readonly scanned: number;
    readonly importPlan: GroundTruthImportPlan;
    readonly writesPerformed: 0;
  };

const prismaStore: GroundTruthStore = {
  async findExisting(projectId) {
    return prisma.policyMemory.findMany({
      where: { projectId, memoryType: PROJECT_ENTITY_ROLE_MEMORY_TYPE },
      select: {
        key: true,
        label: true,
        valueJson: true,
        source: true,
        confidence: true,
        status: true,
      },
    });
  },
  async applyBatch(projectId, memories) {
    await prisma.$transaction(
      memories.map((memory) =>
        prisma.policyMemory.upsert({
          where: {
            projectId_memoryType_key: {
              projectId,
              memoryType: PROJECT_ENTITY_ROLE_MEMORY_TYPE,
              key: memory.key,
            },
          },
          update: {
            label: memory.label,
            valueJson: memory.valueJson as Prisma.InputJsonValue,
            source: memory.source,
            confidence: memory.confidence,
            status: memory.status,
          },
          create: {
            projectId,
            memoryType: PROJECT_ENTITY_ROLE_MEMORY_TYPE,
            key: memory.key,
            label: memory.label,
            valueJson: memory.valueJson as Prisma.InputJsonValue,
            source: memory.source,
            confidence: memory.confidence,
            status: memory.status,
          },
        }),
      ),
    );
  },
  async revertBySource(projectId, source) {
    const result = await prisma.policyMemory.updateMany({
      where: {
        projectId,
        memoryType: PROJECT_ENTITY_ROLE_MEMORY_TYPE,
        source,
        status: { in: ["active", "proposed"] },
      },
      data: { status: "reverted" },
    });
    return result.count;
  },
};

const prismaReclassificationStore: ReclassificationStore = {
  async findCandidates(projectId) {
    return prisma.mailDerivedCandidate.findMany({
      where: {
        status: "proposed",
        mailInsightThread: { is: { projectId } },
      },
      select: {
        id: true,
        candidateType: true,
        title: true,
        summary: true,
        sourceSender: true,
      },
      orderBy: { createdAt: "asc" },
    });
  },
};

export async function importMailGroundTruth(
  manifest: MailGroundTruthManifest,
  options: ImportGroundTruthOptions,
): Promise<GroundTruthImportReport> {
  const dryRun = options.dryRun ?? true;
  const store = options.store ?? prismaStore;
  const existing = await store.findExisting(options.projectId);
  const plan = buildGroundTruthImportPlan(manifest, existing);

  let applied = 0;
  if (!dryRun) {
    const writes = [...plan.create, ...plan.update];
    await store.applyBatch(options.projectId, writes);
    applied = writes.length;
  }

  return { ...plan, dryRun, applied };
}

export async function revertMailGroundTruthImport(
  manifestId: string,
  options: RevertGroundTruthOptions,
): Promise<GroundTruthRevertReport> {
  const source = `ground_truth_manifest:${manifestId}`;
  const store = options.store ?? prismaStore;
  const existing = await store.findExisting(options.projectId);
  const matched = existing.filter(
    (memory) =>
      memory.source === source &&
      (memory.status === "active" || memory.status === "proposed"),
  ).length;
  if (options.dryRun ?? true) {
    return { source, dryRun: true, matched, reverted: 0 };
  }
  const reverted = await store.revertBySource(options.projectId, source);
  return { source, dryRun: false, matched, reverted };
}

export async function dryRunMailGroundTruthReclassification(
  manifest: MailGroundTruthManifest,
  options: ReclassificationOptions,
): Promise<GroundTruthReclassificationReport> {
  const store = options.store ?? prismaReclassificationStore;
  const candidates = await store.findCandidates(options.projectId);
  const plan = buildGroundTruthReclassificationPlan(candidates, manifest);
  const importReport = await importMailGroundTruth(manifest, {
    dryRun: true,
    projectId: options.projectId,
    store: options.groundTruthStore,
  });
  const { create, update, unchanged } = importReport;
  return {
    ...plan,
    scanned: candidates.length,
    importPlan: { create, update, unchanged },
    writesPerformed: 0,
  };
}

export async function getScopedMailCandidateGroundTruthPreview(
  ctx: AuthContext,
  candidateId: string,
  manifest: MailGroundTruthManifest,
): Promise<GroundTruthReclassificationReport | null> {
  return withRlsTransaction(ctx, async (tx) => {
    const candidate = await getScopedMailDerivedCandidateWithClient(
      tx,
      ctx,
      candidateId,
    );
    if (!candidate) return null;

    const candidates = await tx.mailDerivedCandidate.findMany({
      where: {
        status: "proposed",
        mailInsightThread: { is: { projectId: ctx.projectId } },
      },
      select: {
        id: true,
        candidateType: true,
        title: true,
        summary: true,
        sourceSender: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const existing = await tx.policyMemory.findMany({
      where: {
        projectId: ctx.projectId,
        memoryType: PROJECT_ENTITY_ROLE_MEMORY_TYPE,
      },
      select: {
        key: true,
        label: true,
        valueJson: true,
        source: true,
        confidence: true,
        status: true,
      },
    });
    const plan = buildGroundTruthReclassificationPlan(candidates, manifest);
    const importPlan = buildGroundTruthImportPlan(manifest, existing);
    return {
      ...plan,
      scanned: candidates.length,
      importPlan,
      writesPerformed: 0,
    };
  });
}
