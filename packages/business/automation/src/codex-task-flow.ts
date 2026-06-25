import { prisma } from "@ai-portal/db";

import { logStateTransition } from "./audit";
import { createPullRequestForRun } from "./github-connector";

/**
 * Purpose: Phase 11 Codex task create/track flow with GitHub issue + PR linkage.
 * Failure Points: Orphan task without issue; PR number collision in mock mode.
 * Observability: codex_tasks, codex_task_logs, github_issues, pull_requests
 */
export async function createCodexTask(commandRunId: string, title: string) {
  const task = await prisma.codexTask.create({
    data: { commandRunId, title, status: "pending" },
  });

  await prisma.codexTaskLog.create({
    data: {
      codexTaskId: task.id,
      status: "pending",
      message: "Codex task created",
    },
  });

  await logStateTransition({
    entityType: "codex_task",
    entityId: task.id,
    fromStatus: null,
    toStatus: "pending",
    actorType: "codex",
  });

  return task;
}

export async function linkGitHubIssueToCodexTask(
  codexTaskId: string,
  commandRunId: string,
  title: string,
) {
  const issueNumber = Math.floor(Math.random() * 900) + 100;
  const issue = await prisma.gitHubIssue.create({
    data: {
      codexTaskId,
      commandRunId,
      number: issueNumber,
      title,
      url: `https://github.com/whelp99-code/ai-automation-work-portal/issues/${issueNumber}`,
      status: "open",
    },
  });

  await prisma.codexTask.update({
    where: { id: codexTaskId },
    data: { githubIssueId: issue.id, status: "in_progress" },
  });

  await prisma.codexTaskLog.create({
    data: {
      codexTaskId,
      status: "in_progress",
      message: `Linked GitHub issue #${issueNumber}`,
      metadata: { issueId: issue.id },
    },
  });

  return issue;
}

export async function completeCodexTaskWithPr(codexTaskId: string, commandRunId: string) {
  const pr = await createPullRequestForRun(commandRunId, "Codex automated PR");

  await prisma.codexTask.update({
    where: { id: codexTaskId },
    data: { pullRequestId: pr.id, status: "review" },
  });

  await prisma.codexTaskLog.create({
    data: {
      codexTaskId,
      status: "review",
      message: "PR linked; awaiting review",
      metadata: { pullRequestId: pr.id },
    },
  });

  await logStateTransition({
    entityType: "codex_task",
    entityId: codexTaskId,
    fromStatus: "in_progress",
    toStatus: "review",
    actorType: "codex",
  });

  return { pullRequest: pr };
}

export async function finalizeCodexTask(codexTaskId: string) {
  await prisma.codexTask.update({
    where: { id: codexTaskId },
    data: { status: "completed" },
  });

  await prisma.codexTaskLog.create({
    data: {
      codexTaskId,
      status: "completed",
      message: "Codex review complete",
    },
  });

  return prisma.codexTask.findUnique({
    where: { id: codexTaskId },
    include: { logs: true },
  });
}

export async function listCodexTasks(limit = 20) {
  return prisma.codexTask.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { logs: { orderBy: { createdAt: "desc" }, take: 3 } },
  });
}
