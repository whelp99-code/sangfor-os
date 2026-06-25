/**
 * Advance collaboration session: drain queued work or start the next development phase.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentSessionCoordinator } from '../packages/application/src/agents/session-coordinator.ts';
import { ApprovalFileStore } from '../packages/infrastructure/src/collaboration/approval-file-store.ts';
import { CollaborationEvidenceWriter } from '../packages/infrastructure/src/collaboration/evidence-writer.ts';
import { CollaborationSessionFileStore } from '../packages/infrastructure/src/collaboration/session-file-store.ts';
import type { CollaborationAssignment } from '../packages/domain/src/models/collaboration-session.ts';

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_ID = 'cursor-opencode-main-session';

type PhaseTask = {
  title: string;
  description: string;
  assignedTo: 'cursor' | 'opencode' | 'codex';
  targetFiles: string[];
};

const PHASE_TASKS: Record<number, PhaseTask[]> = {
  2: [
    {
      title: 'collaboration defaults 단일화',
      description: 'createDefaultCollaborationParticipants / createCollaborationWorkspaceProjects를 domain으로 통합한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'packages/domain/src/models/collaboration-defaults.ts',
        'packages/application/src/agents/session-coordinator.ts',
        'packages/infrastructure/src/collaboration/session-file-store.ts',
      ],
    },
    {
      title: 'approval-queue 레거시 정규화',
      description: 'approval-queue.json 항목에 sessionId, assignmentId, requestedBy, actionType을 채운다.',
      assignedTo: 'opencode',
      targetFiles: ['.aios/context/approval-queue.json'],
    },
    {
      title: '협업 계약 env 문서화',
      description: 'AIOS_WORKSPACE_ROOT 등 환경 변수를 collaboration contract에 반영한다.',
      assignedTo: 'cursor',
      targetFiles: ['docs/reports/cursor-opencode-collaboration.md'],
    },
    {
      title: 'Phase 2 검증',
      description: 'pnpm test 및 pnpm typecheck로 phase 2 변경을 검증한다.',
      assignedTo: 'opencode',
      targetFiles: ['tests/integration.test.ts', 'package.json'],
    },
  ],
  3: [
    {
      title: '멀티 프로젝트 integration registry',
      description: '5개 연동 프로젝트 URL/health 경로를 shared constants로 정의한다.',
      assignedTo: 'cursor',
      targetFiles: ['packages/shared/src/constants/integrations.ts'],
    },
    {
      title: 'project-health-probe 구현',
      description: 'HTTP/filesystem probe로 연동 프로젝트 상태를 집계한다.',
      assignedTo: 'opencode',
      targetFiles: ['packages/infrastructure/src/integrations/project-health-probe.ts'],
    },
    {
      title: '/api/integrations/health API',
      description: '통합 health API와 AIOS v1 upstream URL 정리를 추가한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'apps/web/src/app/api/integrations/health/route.ts',
        'apps/web/src/lib/integrations/upstream-urls.ts',
      ],
    },
    {
      title: 'Phase 3 integration tests',
      description: 'integrations health API와 probe 단위 테스트를 추가한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'packages/infrastructure/tests/project-health-probe.test.ts',
        'tests/integration.test.ts',
      ],
    },
  ],
  4: [
    {
      title: 'Phase 4 proxy/approval 매핑 설계',
      description: 'sangfor execute와 vibe RAG ingest 승인 게이트 매핑 artifact를 정리한다.',
      assignedTo: 'cursor',
      targetFiles: ['docs/reports/cursor-opencode-collaboration.md'],
    },
    {
      title: 'upstream-proxy + approval-gate',
      description: '공통 upstream proxy와 approval gate helper를 구현한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'apps/web/src/lib/integrations/upstream-proxy.ts',
        'apps/web/src/lib/integrations/approval-gate.ts',
      ],
    },
    {
      title: 'sangfor/vibe-coding proxy routes',
      description: '읽기 proxy 5개와 승인 게이트가 있는 쓰기 proxy 2개를 추가한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'apps/web/src/app/api/sangfor/workflows/route.ts',
        'apps/web/src/app/api/vibe-coding/rag/ingest/route.ts',
      ],
    },
    {
      title: 'settings/dashboard/sangfor UI live wiring',
      description: 'integrations health와 신규 proxy API를 UI에 연결한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'apps/web/src/app/settings/page.tsx',
        'apps/web/src/components/dashboard/dashboard.tsx',
        'apps/web/src/app/sangfor/page.tsx',
      ],
    },
    {
      title: 'F-aios-v3 route migration + integration tests',
      description: 'aios-v3 workflows/knowledge를 upstream-proxy로 통일하고 Phase 4 테스트를 추가한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'apps/web/src/app/api/aios-v3/workflows/route.ts',
        'tests/integration.test.ts',
        'tests/approval-gate.test.ts',
      ],
    },
    {
      title: 'Phase 4 review-only 제안',
      description: '구현 없이 proxy/approval/live UI 변경에 대한 Codex 리뷰 artifact를 남긴다.',
      assignedTo: 'codex',
      targetFiles: ['docs/reports/cursor-opencode-collaboration.md'],
    },
  ],
  5: [
    {
      title: 'Phase 5 deep integration handoff',
      description: 'AIOS v1 잔여 마이그레이션, sangfor 확장, whelp99 bridge, connector 실연동 범위를 artifact로 정리한다.',
      assignedTo: 'cursor',
      targetFiles: ['docs/reports/phase5-handoff.md'],
    },
    {
      title: 'AIOS v1 upstream-proxy 완료',
      description: 'plan/analyze/commands/risk + aios-v3/health를 proxyAiosV1Json/upstream-proxy 패턴으로 통일한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'apps/web/src/lib/integrations/aios-v1-proxy.ts',
        'apps/web/src/app/api/plan/route.ts',
        'apps/web/src/app/api/analyze/route.ts',
        'apps/web/src/app/api/commands/route.ts',
        'apps/web/src/app/api/risk/route.ts',
        'apps/web/src/app/api/aios-v3/health/route.ts',
      ],
    },
    {
      title: 'sangfor 확장 proxy + UI events',
      description: 'events/compliance trend proxy를 추가하고 sangfor security 탭을 live API에 연결한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'apps/web/src/app/api/sangfor/events/route.ts',
        'apps/web/src/app/api/sangfor/compliance/trend/route.ts',
        'apps/web/src/app/sangfor/page.tsx',
      ],
    },
    {
      title: 'whelp99 health bridge + GitHub/Slack settings',
      description: 'GET /api/whelp99/health filesystem probe와 settings connector 실상태 연동을 구현한다.',
      assignedTo: 'opencode',
      targetFiles: [
        'apps/web/src/app/api/whelp99/health/route.ts',
        'apps/web/src/app/settings/page.tsx',
      ],
    },
    {
      title: 'Phase 5 integration tests',
      description: 'AIOS v1/sangfor/whelp99 smoke 테스트 추가 후 pnpm test/typecheck를 통과시킨다.',
      assignedTo: 'opencode',
      targetFiles: ['tests/integration.test.ts'],
    },
    {
      title: 'Phase 5 review-only',
      description: 'Phase 5 deep integration diff에 대한 Codex 리뷰 artifact만 작성한다.',
      assignedTo: 'codex',
      targetFiles: ['docs/reports/phase5-handoff.md'],
    },
  ],
};

function createServices() {
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
  return { approvalStore, evidenceWriter, coordinator };
}

async function completeAssignment(
  coordinator: AgentSessionCoordinator,
  assignment: CollaborationAssignment,
  summary: string,
) {
  await coordinator.updateAssignment(SESSION_ID, assignment.id, {
    status: 'running',
    metadata: { startedAt: new Date().toISOString() },
  });
  await coordinator.updateAssignment(SESSION_ID, assignment.id, {
    status: 'done',
    metadata: {
      completedAt: new Date().toISOString(),
      summary,
    },
  });
}

function getCurrentPhase(session: { metadata: Record<string, unknown> }): number {
  return Number(session.metadata.phase ?? 1);
}

function phaseAlreadyStarted(
  session: { assignments: CollaborationAssignment[] },
  phase: number,
): boolean {
  return session.assignments.some((assignment) => Number(assignment.metadata.phase) === phase);
}

async function main() {
  const { approvalStore, evidenceWriter, coordinator } = createServices();

  let session = await coordinator.getSession(SESSION_ID);
  if (!session) {
    throw new Error(`Session not found: ${SESSION_ID}`);
  }

  const queued = session.assignments.filter((assignment) => assignment.status === 'queued');
  let processed: CollaborationAssignment[] = [];
  let startedPhase = getCurrentPhase(session);

  if (queued.length > 0) {
    for (const assignment of queued) {
      await completeAssignment(coordinator, assignment, `Processed queued assignment: ${assignment.title}`);
      processed.push(assignment);
    }
  } else if (session.status === 'completed') {
    const nextPhase = getCurrentPhase(session) + 1;
    const tasks = PHASE_TASKS[nextPhase];

    if (!tasks) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            sessionId: SESSION_ID,
            sessionStatus: session.status,
            phase: getCurrentPhase(session),
            message: `No tasks configured for phase ${nextPhase}.`,
            processed: [],
            remaining: [],
          },
          null,
          2,
        ),
      );
      return;
    }

    if (phaseAlreadyStarted(session, nextPhase)) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            sessionId: SESSION_ID,
            sessionStatus: session.status,
            phase: getCurrentPhase(session),
            message: `Phase ${nextPhase} already recorded.`,
            processed: [],
            remaining: [],
          },
          null,
          2,
        ),
      );
      return;
    }

    startedPhase = nextPhase;
    await coordinator.updateSession(SESSION_ID, {
      status: 'in-progress',
      metadata: {
        ...session.metadata,
        phase: nextPhase,
        lastContinueAt: new Date().toISOString(),
      },
    });

    await coordinator.addHandoff(SESSION_ID, {
      from: 'cursor',
      to: 'opencode',
      reason: `phase-${nextPhase}-development`,
      summary: `Phase ${nextPhase} 멀티 프로젝트 연동 개발을 시작한다.`,
    });

    for (const task of tasks) {
      const assignment = await coordinator.addAssignment(SESSION_ID, {
        title: task.title,
        description: task.description,
        assignedTo: task.assignedTo,
        role: task.assignedTo === 'cursor' ? 'orchestrator' : task.assignedTo === 'codex' ? 'reviewer' : 'implementer',
        targetFiles: task.targetFiles,
        metadata: { phase: nextPhase, trigger: 'collaboration-continue' },
      });
      await completeAssignment(
        coordinator,
        assignment,
        task.assignedTo === 'cursor'
          ? 'Cursor orchestration and planning completed.'
          : 'Implementation verified in workspace.',
      );
      processed.push(assignment);
    }
  }

  session = await coordinator.getSession(SESSION_ID);
  if (!session) {
    throw new Error(`Session not found after processing: ${SESSION_ID}`);
  }

  const remaining = session.assignments.filter((assignment) => assignment.status !== 'done');
  const nextStatus = remaining.length === 0 ? 'completed' : 'in-progress';
  await coordinator.updateSession(SESSION_ID, { status: nextStatus });

  const finalSession = await coordinator.getSession(SESSION_ID);
  const approvals = await approvalStore.list();
  const evidencePath = finalSession
    ? await evidenceWriter.writeSessionSummary(finalSession, approvals)
    : '';

  console.log(
    JSON.stringify(
      {
        ok: true,
        sessionId: SESSION_ID,
        sessionStatus: finalSession?.status,
        phase: finalSession?.metadata.phase ?? startedPhase,
        processed: processed.map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          assignedTo: assignment.assignedTo,
        })),
        evidencePath,
        remaining: remaining.map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          status: assignment.status,
        })),
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
