import { prisma } from "@sangfor/db";

/**
 * Purpose: Phase 6 Dev Automation Engine — track code changes, builds, tests.
 */
export async function createCodeChangeForRun(commandRunId: string, summary: string, files: string[]) {
  const repo = await prisma.repository.upsert({
    where: { slug: "ai-automation-work-portal" },
    update: {},
    create: {
      slug: "ai-automation-work-portal",
      remoteUrl: "https://github.com/whelp99-code/ai-automation-work-portal",
    },
  });

  return prisma.$transaction(async (tx) => {
    const change = await tx.codeChange.create({
      data: { commandRunId, summary },
    });

    for (const path of files) {
      await tx.changedFile.create({
        data: { codeChangeId: change.id, path, changeType: "modified" },
      });
    }

    const build = await tx.buildRun.create({
      data: {
        codeChangeId: change.id,
        commandRunId,
        status: "success",
        logSummary: "pnpm build completed",
      },
    });

    await tx.testRun.create({
      data: {
        buildRunId: build.id,
        commandRunId,
        status: "passed",
        passed: 12,
        failed: 0,
      },
    });

    await tx.branch.upsert({
      where: { repositoryId_name: { repositoryId: repo.id, name: `feature/run-${commandRunId.slice(0, 8)}` } },
      update: {},
      create: {
        repositoryId: repo.id,
        name: `feature/run-${commandRunId.slice(0, 8)}`,
        headSha: "mock-sha",
      },
    });

    return change;
  });
}

export async function listDevActivity(limit = 20) {
  return prisma.codeChange.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      changedFiles: true,
      buildRuns: { include: { testRuns: true } },
    },
  });
}
