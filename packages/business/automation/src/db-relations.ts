import { prisma } from "@ai-portal/db";

/**
 * Purpose: Phase 11 DB relation integrity checks for Beta readiness.
 */
export async function checkDbRelations() {
  const [commandRuns, orphanToolCalls, orphanChangedFiles, pendingOutbox, codexWithoutLogs] =
    await Promise.all([
      prisma.commandRun.count(),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint as count FROM tool_calls tc
        LEFT JOIN agent_assignments aa ON tc.agent_assignment_id = aa.id
        WHERE aa.id IS NULL
      `,
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint as count FROM changed_files cf
        LEFT JOIN code_changes cc ON cf.code_change_id = cc.id
        WHERE cc.id IS NULL
      `,
      prisma.outboxEvent.count({ where: { status: "pending" } }),
      prisma.codexTask.count({ where: { logs: { none: {} } } }),
    ]);

  const orphanToolCount = Number(orphanToolCalls[0]?.count ?? 0);
  const orphanFileCount = Number(orphanChangedFiles[0]?.count ?? 0);

  const sampleRun = await prisma.commandRun.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      workflows: {
        include: {
          steps: {
            include: {
              agentAssignments: { include: { toolCalls: true } },
              validationResults: { include: { reports: true } },
            },
          },
        },
      },
      intent: true,
      risk: true,
    },
  });

  const chainOk = Boolean(
    sampleRun?.workflows[0]?.steps.some((s) => s.agentAssignments.length > 0),
  );

  return {
    commandRuns,
    orphanToolCalls: orphanToolCount,
    orphanChangedFiles: orphanFileCount,
    pendingOutbox,
    codexWithoutLogs,
    sampleRunId: sampleRun?.id ?? null,
    chainOk,
    ok: orphanToolCount === 0 && orphanFileCount === 0 && chainOk,
  };
}
