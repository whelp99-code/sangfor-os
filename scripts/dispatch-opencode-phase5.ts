/**
 * Cursor → opencode Phase 5 dispatch
 * Reads phase5-handoff and executes opencode assignments sequentially.
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

const OPENCODE_TASKS = [
  {
    title: 'AIOS v1 upstream-proxy 완료',
    targetFiles: [
      'apps/web/src/app/api/plan/route.ts',
      'apps/web/src/app/api/analyze/route.ts',
      'apps/web/src/app/api/commands/route.ts',
      'apps/web/src/app/api/risk/route.ts',
      'apps/web/src/app/api/aios-v3/health/route.ts',
      'apps/web/src/lib/integrations/aios-v1-proxy.ts',
    ],
    prompt: `Phase 5 Task 1 — AIOS v1 upstream-proxy 완료.

Read docs/reports/phase5-handoff.md Task 1.

Migrate plan, analyze, commands, risk routes to proxyAiosV1Json + upstream-proxy.
Migrate aios-v3/health to getFaiosV3Url + upstream-proxy.
Keep existing fallback UX when upstream is unreachable.
Do not skip files already partially migrated (customers/tasks/etc are done).`,
  },
  {
    title: 'sangfor 확장 proxy + UI events',
    targetFiles: [
      'apps/web/src/app/api/sangfor/events/route.ts',
      'apps/web/src/app/api/sangfor/compliance/trend/route.ts',
      'apps/web/src/app/sangfor/page.tsx',
    ],
    prompt: `Phase 5 Task 2 — sangfor 확장 proxy + UI.

Read docs/reports/phase5-handoff.md Task 2.

Add GET /api/sangfor/events → upstream /api/events.
Add GET /api/sangfor/compliance/trend → upstream /api/compliance/trend (query passthrough).
Wire sangfor page security tab to live events with mockEvents fallback.`,
  },
  {
    title: 'whelp99 health bridge + GitHub/Slack settings',
    targetFiles: [
      'apps/web/src/app/api/whelp99/health/route.ts',
      'apps/web/src/app/settings/page.tsx',
    ],
    prompt: `Phase 5 Task 3 — whelp99 + connectors.

Read docs/reports/phase5-handoff.md Task 3 & 4.

Add GET /api/whelp99/health using probeIntegrationTarget for whelp99-code-sangfor-engineer-mcp.
Update settings integrations tab: GitHub status from GET /api/github connected field; Slack from SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN env.`,
  },
  {
    title: 'Phase 5 integration tests',
    targetFiles: ['tests/integration.test.ts'],
    prompt: `Phase 5 Task 4 — tests.

Read docs/reports/phase5-handoff.md Task 5.

Add integration smoke tests for AIOS v1 customers proxy, sangfor events proxy, whelp99 health.
Run pnpm test and pnpm typecheck; fix any failures you introduced.`,
  },
];

function createOpencodeRuntime(): CommandAgentRuntime {
  return new CommandAgentRuntime({
    agentType: 'opencode',
    command: process.env.OPENCODE_COMMAND || 'opencode',
    cwd: WORKSPACE_ROOT,
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
      phase: 5,
      lastOpencodeDispatchAt: new Date().toISOString(),
    },
  });

  await coordinator.addHandoff(SESSION_ID, {
    from: 'cursor',
    to: 'opencode',
    reason: 'phase-5-dispatch',
    summary: 'Cursor가 Phase 5 구현 4건을 opencode에 순차 실행 지시한다.',
  });

  const runtime = createOpencodeRuntime();
  await runtime.initialize();

  const results: Array<{ title: string; status: string; summary: string }> = [];

  for (const task of OPENCODE_TASKS) {
    const assignment = await coordinator.addAssignment(SESSION_ID, {
      title: task.title,
      description: task.prompt,
      assignedTo: 'opencode',
      role: 'implementer',
      targetFiles: task.targetFiles,
      metadata: { phase: 5, trigger: 'cursor-dispatch', dispatchedAt: new Date().toISOString() },
    });

    await coordinator.updateAssignment(SESSION_ID, assignment.id, {
      status: 'running',
      metadata: { startedAt: new Date().toISOString() },
    });

    console.error(`[dispatch] opencode: ${task.title}`);

    const job = await runtime.executeJob({
      taskId: assignment.id,
      agentType: 'opencode',
      input: {
        task: task.prompt,
        context: {
          sessionId: SESSION_ID,
          assignmentId: assignment.id,
          targetFiles: task.targetFiles,
          handoffDoc: 'docs/reports/phase5-handoff.md',
        },
        constraints: ['implement in workspace', 'follow phase5-handoff acceptance criteria'],
      },
    });

    const summary =
      typeof job.output?.result === 'string'
        ? job.output.result.slice(0, 500)
        : job.error ?? 'no output';

    await coordinator.updateAssignment(SESSION_ID, assignment.id, {
      status: job.status === 'completed' ? 'done' : 'failed',
      metadata: {
        jobId: job.id,
        command: job.metadata?.command,
        exitCode: job.metadata?.exitCode,
        summary,
        error: job.error,
        completedAt: new Date().toISOString(),
      },
    });

    await coordinator.addArtifact(SESSION_ID, {
      type: job.status === 'completed' ? 'log' : 'failure',
      path: '',
      description: `opencode dispatch: ${task.title}`,
      createdAt: new Date(),
      metadata: {
        assignmentId: assignment.id,
        status: job.status,
        summary,
        error: job.error,
      },
    });

    results.push({ title: task.title, status: job.status, summary });
  }

  await runtime.shutdown();

  const finalSession = await coordinator.getSession(SESSION_ID);
  const approvals = await approvalStore.list();
  const evidencePath = finalSession
    ? await evidenceWriter.writeSessionSummary(finalSession, approvals)
    : '';

  await mkdir(join(WORKSPACE_ROOT, 'docs', 'evidence'), { recursive: true });

  console.log(
    JSON.stringify(
      {
        ok: results.every((entry) => entry.status === 'completed'),
        sessionId: SESSION_ID,
        phase: 5,
        dispatched: results,
        evidencePath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
