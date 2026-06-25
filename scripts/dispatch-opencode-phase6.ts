/**
 * Cursor → opencode Phase 6 dispatch
 * Cross-repo diagnostic fixes from phase6-diagnostic-fix-handoff.md
 */

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentSessionCoordinator } from '../packages/application/src/agents/session-coordinator.ts';
import { ApprovalFileStore } from '../packages/infrastructure/src/collaboration/approval-file-store.ts';
import { CollaborationEvidenceWriter } from '../packages/infrastructure/src/collaboration/evidence-writer.ts';
import { CollaborationSessionFileStore } from '../packages/infrastructure/src/collaboration/session-file-store.ts';
import { CommandAgentRuntime } from '../packages/infrastructure/src/agents/command-agent-runtime.ts';

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_ID = 'cursor-opencode-main-session';
const HANDOFF_DOC = 'docs/reports/phase6-diagnostic-fix-handoff.md';

const PLAYGROUND = dirname(WORKSPACE_ROOT);

interface OpencodeTask {
  title: string;
  cwd: string;
  targetFiles: string[];
  prompt: string;
}

const OPENCODE_TASKS: OpencodeTask[] = [
  {
    title: 'AIOSv2 settings build fix',
    cwd: WORKSPACE_ROOT,
    targetFiles: [
      'apps/web/src/app/settings/layout.tsx',
      'apps/web/src/app/settings/page.tsx',
    ],
    prompt: `Phase 6 Task 1 — AIOSv2 settings build fix.

Read ${HANDOFF_DOC} Task 1 in full.

Workspace: ${WORKSPACE_ROOT}

Create apps/web/src/app/settings/layout.tsx with export const dynamic = 'force-dynamic' and SessionProvider wrapper (see dashboard/page.tsx pattern).

Run: cd apps/web && pnpm build
Must pass without /settings prerender error.

Do not break pnpm test or pnpm typecheck at repo root.`,
  },
  {
    title: 'VibeCodingOS GitHub API facade',
    cwd: join(PLAYGROUND, 'vibe-coding-os'),
    targetFiles: [
      'lib/tools/github.ts',
      'app/api/github/pr/route.ts',
      'app/api/github/issues/route.ts',
      'scripts/assert-github-api.ts',
    ],
    prompt: `Phase 6 Task 2 — VibeCodingOS GitHub API facade.

Read ${join(WORKSPACE_ROOT, HANDOFF_DOC)} Task 2 in full.

Workspace: ${join(PLAYGROUND, 'vibe-coding-os')}

Implement all exports expected by scripts/assert-github-api.ts in lib/tools/github.ts using Octokit via getGitHubClient().

GITHUB_TOKEN in lib/github/project-repo.ts is already correct — do not change.

Verify:
  npx tsx scripts/assert-github-api.ts
  pnpm build`,
  },
  {
    title: 'Sangfor MCP build chain fix',
    cwd: join(PLAYGROUND, 'sangfor-mcp-workflow'),
    targetFiles: [
      'tsconfig.json',
      'apps/operator-console/tsconfig.json',
      'apps/operator-console/package.json',
      'tests/ai-workflow.test.ts',
    ],
    prompt: `Phase 6 Task 3 — Sangfor MCP build chain.

Read ${join(WORKSPACE_ROOT, HANDOFF_DOC)} Task 3 in full.

Workspace: ${join(PLAYGROUND, 'sangfor-mcp-workflow')}

Fix pnpm build (tsc -b / tsconfig / @sangfor/* module resolution).
Fix operator-console missing tsconfig.json.
Skip LM Studio AI workflow tests when healthCheck() is false.

Verify: pnpm build && pnpm test`,
  },
  {
    title: 'Cross-repo build verification',
    cwd: WORKSPACE_ROOT,
    targetFiles: [HANDOFF_DOC, 'docs/evidence/cursor-opencode-main-session.md'],
    prompt: `Phase 6 Task 4 — Cross-repo verification.

Read ${HANDOFF_DOC} acceptance criteria.

Run all verification commands for:
- AIOSv2_integration (pnpm test, pnpm typecheck, apps/web pnpm build)
- vibe-coding-os (pnpm build, npx tsx scripts/assert-github-api.ts)
- sangfor-mcp-workflow (pnpm build, pnpm test)

If Task 1-3 left any failure, fix it in the appropriate repo.

Report pass/fail table in your output.`,
  },
];

function createOpencodeRuntime(cwd: string): CommandAgentRuntime {
  return new CommandAgentRuntime({
    agentType: 'opencode',
    command: process.env.OPENCODE_COMMAND || 'opencode',
    cwd,
    timeoutMs: 900_000,
    argsBuilder: (request) => ['run', request.input.task],
  });
}

async function main() {
  const sessionStore = new CollaborationSessionFileStore({
    workspaceRoot: WORKSPACE_ROOT,
    filePath: join(WORKSPACE_ROOT, '.aios', 'context', 'collaboration-state.json'),
  });
  const approvalStore = new ApprovalFileStore({
    filePath: join(WORKSPACE_ROOT, '.aios', 'context', 'approval-queue.json'),
  });
  const evidenceWriter = new CollaborationEvidenceWriter({
    outputDir: join(WORKSPACE_ROOT, 'docs', 'evidence'),
  });
  const coordinator = new AgentSessionCoordinator(sessionStore);

  const session = await coordinator.getSession(SESSION_ID);
  if (!session) {
    throw new Error(`Session not found: ${SESSION_ID}`);
  }

  await coordinator.updateSession(SESSION_ID, {
    status: 'in-progress',
    metadata: {
      ...session.metadata,
      phase: 6,
      objective: 'diagnostic-fix-all-build-blockers',
      lastOpencodeDispatchAt: new Date().toISOString(),
    },
  });

  await coordinator.addHandoff(SESSION_ID, {
    from: 'cursor',
    to: 'opencode',
    reason: 'phase-6-diagnostic-fix-dispatch',
    summary:
      'Cursor가 진단 리포트 검증 결과 4건(AIOSv2 settings, Vibe GitHub facade, Sangfor build, cross-repo verify)을 opencode에 순차 실행 지시한다.',
  });

  const results: Array<{ title: string; status: string; summary: string; cwd: string }> = [];

  for (const task of OPENCODE_TASKS) {
    const assignment = await coordinator.addAssignment(SESSION_ID, {
      title: task.title,
      description: task.prompt,
      assignedTo: 'opencode',
      role: 'implementer',
      targetFiles: task.targetFiles,
      metadata: {
        phase: 6,
        trigger: 'cursor-dispatch',
        cwd: task.cwd,
        handoffDoc: HANDOFF_DOC,
        dispatchedAt: new Date().toISOString(),
      },
    });

    await coordinator.updateAssignment(SESSION_ID, assignment.id, {
      status: 'running',
      metadata: { startedAt: new Date().toISOString() },
    });

    console.error(`[dispatch] opencode (${task.cwd}): ${task.title}`);

    const runtime = createOpencodeRuntime(task.cwd);
    await runtime.initialize();

    const job = await runtime.executeJob({
      taskId: assignment.id,
      agentType: 'opencode',
      input: {
        task: task.prompt,
        context: {
          sessionId: SESSION_ID,
          assignmentId: assignment.id,
          cwd: task.cwd,
          targetFiles: task.targetFiles,
          handoffDoc: HANDOFF_DOC,
        },
        constraints: ['implement in specified cwd', 'follow phase6 handoff acceptance criteria'],
      },
    });

    await runtime.shutdown();

    const summary =
      typeof job.output?.result === 'string'
        ? job.output.result.slice(0, 800)
        : job.error ?? 'no output';

    await coordinator.updateAssignment(SESSION_ID, assignment.id, {
      status: job.status === 'completed' ? 'done' : 'failed',
      metadata: {
        jobId: job.id,
        cwd: task.cwd,
        command: job.metadata?.command,
        exitCode: job.metadata?.exitCode,
        summary,
        error: job.error,
        completedAt: new Date().toISOString(),
      },
    });

    await coordinator.addArtifact(SESSION_ID, {
      type: job.status === 'completed' ? 'log' : 'failure',
      path: task.cwd,
      description: `opencode phase6: ${task.title}`,
      createdAt: new Date(),
      metadata: {
        assignmentId: assignment.id,
        status: job.status,
        summary,
        error: job.error,
      },
    });

    results.push({ title: task.title, status: job.status, summary, cwd: task.cwd });
  }

  const finalSession = await coordinator.getSession(SESSION_ID);
  const approvals = await approvalStore.list();
  const evidencePath = finalSession
    ? await evidenceWriter.writeSessionSummary(finalSession, approvals)
    : '';

  await mkdir(join(WORKSPACE_ROOT, 'docs', 'evidence'), { recursive: true });

  const allDone = results.every((entry) => entry.status === 'completed');

  await coordinator.updateSession(SESSION_ID, {
    status: allDone ? 'completed' : 'in-progress',
    metadata: {
      ...finalSession?.metadata,
      phase: 6,
      lastPhase6DispatchResult: allDone ? 'all-completed' : 'partial-failure',
      lastOpencodeDispatchAt: new Date().toISOString(),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: allDone,
        sessionId: SESSION_ID,
        phase: 6,
        handoffDoc: HANDOFF_DOC,
        dispatched: results,
        evidencePath,
      },
      null,
      2,
    ),
  );

  if (!allDone) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
