import { prisma } from "@ai-portal/db";

import { logStateTransition } from "./audit";
import { createCodeChangeForRun } from "./dev-engine";

/**
 * Purpose: Phase 11 Cursor session tracking — branch, files, build/test results.
 * Failure Points: Session left active; code change not linked to command run.
 * Observability: cursor_sessions, code_changes, build_runs, test_runs
 */
export async function startCursorSession(input: {
  commandRunId: string;
  branchName: string;
  taskSummary: string;
}) {
  const session = await prisma.cursorSession.create({
    data: {
      commandRunId: input.commandRunId,
      branchName: input.branchName,
      taskSummary: input.taskSummary,
      status: "active",
    },
  });

  await logStateTransition({
    entityType: "cursor_session",
    entityId: session.id,
    fromStatus: null,
    toStatus: "active",
    actorType: "cursor",
  });

  return session;
}

export async function recordCursorSessionWork(input: {
  sessionId: string;
  commandRunId: string;
  summary: string;
  files: string[];
  buildStatus: string;
  testStatus: string;
}) {
  await createCodeChangeForRun(input.commandRunId, input.summary, input.files);

  return prisma.cursorSession.update({
    where: { id: input.sessionId },
    data: {
      buildStatus: input.buildStatus,
      testStatus: input.testStatus,
    },
  });
}

export async function completeCursorSession(sessionId: string) {
  const session = await prisma.cursorSession.update({
    where: { id: sessionId },
    data: { status: "completed", completedAt: new Date() },
  });

  await logStateTransition({
    entityType: "cursor_session",
    entityId: sessionId,
    fromStatus: "active",
    toStatus: "completed",
    actorType: "cursor",
  });

  return session;
}

export async function listCursorSessions(limit = 20) {
  return prisma.cursorSession.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
