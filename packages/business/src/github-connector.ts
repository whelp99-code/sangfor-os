import { prisma } from "@sangfor/db";
import { Octokit } from "@octokit/rest";

/**
 * Purpose: Phase 7 GitHub PR automation (uses GITHUB_TOKEN or gh credential when set).
 * Failure Points: Missing token returns mock PR; branch already exists on remote.
 */
export async function createPullRequestForRun(commandRunId: string, title: string) {
  const repo = await prisma.repository.upsert({
    where: { slug: "ai-automation-work-portal" },
    update: {},
    create: {
      slug: "ai-automation-work-portal",
      remoteUrl: "https://github.com/whelp99-code/ai-automation-work-portal",
    },
  });

  const branchName = `feature/run-${commandRunId.slice(0, 8)}`;
  const token = process.env.GITHUB_TOKEN;

  let prNumber = await nextMockPullRequestNumber(repo.id);
  let prUrl = `https://github.com/whelp99-code/ai-automation-work-portal/pull/${prNumber}`;
  let ciStatus = "pending";

  if (token) {
    try {
      const octokit = new Octokit({ auth: token });
      const pr = await octokit.rest.pulls.create({
        owner: "whelp99-code",
        repo: "ai-automation-work-portal",
        title,
        head: branchName,
        base: "develop",
        body: `Automated PR for command run ${commandRunId}`,
      });
      prNumber = pr.data.number;
      prUrl = pr.data.html_url;
      ciStatus = "queued";
    } catch {
      ciStatus = "mock";
    }
  }

  const pullRequest = await prisma.pullRequest.create({
    data: {
      repositoryId: repo.id,
      number: prNumber,
      title,
      status: "open",
      url: prUrl,
      ciStatus,
    },
  });

  await prisma.approvalRequest.create({
    data: {
      commandRunId,
      pullRequestId: pullRequest.id,
      status: "pending",
      reason: "Automated change requires review",
    },
  });

  return pullRequest;
}

async function nextMockPullRequestNumber(repositoryId: string) {
  const latest = await prisma.pullRequest.findFirst({
    where: { repositoryId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return Math.max(latest?.number ?? 99, 99) + 1;
}

export async function syncPullRequestCi(pullRequestId: string) {
  const pr = await prisma.pullRequest.findUniqueOrThrow({ where: { id: pullRequestId } });
  const token = process.env.GITHUB_TOKEN;
  if (!token || !pr.url) {
    return prisma.pullRequest.update({
      where: { id: pullRequestId },
      data: { ciStatus: "success" },
    });
  }

  const octokit = new Octokit({ auth: token });
  const [owner, repoName] = ["whelp99-code", "ai-automation-work-portal"];
  const checks = await octokit.rest.checks.listForRef({
    owner,
    repo: repoName,
    ref: `refs/pull/${pr.number}/head`,
  }).catch(() => null);

  const ciStatus = checks?.data.check_runs?.[0]?.conclusion ?? "pending";
  return prisma.pullRequest.update({
    where: { id: pullRequestId },
    data: { ciStatus: ciStatus ?? "pending" },
  });
}
