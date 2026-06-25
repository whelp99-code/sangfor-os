/**
 * Cursor + opencode collaboration contract runner.
 * Cursor: orchestration, state, evidence. opencode: queued implementation tasks.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentSessionCoordinator } from "../packages/application/src/agents/session-coordinator.ts";
import { ApprovalFileStore } from "../packages/infrastructure/src/collaboration/approval-file-store.ts";
import { CollaborationEvidenceWriter } from "../packages/infrastructure/src/collaboration/evidence-writer.ts";
import { CollaborationSessionFileStore } from "../packages/infrastructure/src/collaboration/session-file-store.ts";
import {
  createCursorRuntime,
  createOpencodeRuntime,
} from "../packages/infrastructure/src/agents/command-agent-runtime.ts";

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_ID = "cursor-opencode-main-session";

async function main() {
  const sessionStore = new CollaborationSessionFileStore({
    workspaceRoot: WORKSPACE_ROOT,
    filePath: join(
      WORKSPACE_ROOT,
      ".aios",
      "context",
      "collaboration-state.json",
    ),
  });
  const approvalStore = new ApprovalFileStore({
    filePath: join(WORKSPACE_ROOT, ".aios", "context", "approval-queue.json"),
  });
  const evidenceWriter = new CollaborationEvidenceWriter({
    outputDir: join(WORKSPACE_ROOT, "docs", "evidence"),
  });
  const coordinator = new AgentSessionCoordinator(sessionStore);

  let session = await coordinator.getSession(SESSION_ID);
  if (!session) {
    throw new Error(`Session not found: ${SESSION_ID}`);
  }

  const participants = [...session.participants];
  if (!participants.some((participant) => participant.tool === "codex")) {
    participants.push({
      tool: "codex",
      role: "reviewer",
      displayName: "Codex",
      active: true,
      capabilities: ["review", "refactor-suggestion", "cleanup"],
    });
    await coordinator.updateSession(SESSION_ID, {
      status: "in-progress",
      metadata: {
        ...session.metadata,
        contractVersion: "cursor-opencode-collaboration-v1",
        lastOrchestrationAt: new Date().toISOString(),
      },
    });
    const state = await sessionStore.loadState();
    const index = state.sessions.findIndex((entry) => entry.id === SESSION_ID);
    if (index >= 0) {
      state.sessions[index] = { ...state.sessions[index], participants };
      await sessionStore.saveState(state);
    }
  }

  const planningAssignment = await coordinator.addAssignment(SESSION_ID, {
    title: "멀티 프로젝트 연동 작업 분해",
    description:
      "AIOS v1, F-aios-v3-core, sangfor-mcp-workflow, vibe-coding-os, whelp99-code-sangfor-engineer-mcp 연동 단계를 assignment로 분해한다.",
    assignedTo: "cursor",
    role: "orchestrator",
    targetFiles: [
      "docs/reports/cursor-opencode-collaboration.md",
      ".aios/context/collaboration-state.json",
    ],
    metadata: { phase: "decomposition", trigger: "contract-runner" },
  });

  await coordinator.updateAssignment(SESSION_ID, planningAssignment.id, {
    status: "running",
    metadata: { startedAt: new Date().toISOString() },
  });

  const decomposition = [
    {
      title: "F-aios-v3-core health proxy 검증",
      description:
        "apps/web collaboration 및 aios-v3 health proxy 경로를 검증한다.",
      targetFiles: [
        "apps/web/src/app/api/aios-v3/health/route.ts",
        "tests/integration.test.ts",
      ],
    },
    {
      title: "workflow 패키지 typecheck 복구",
      description:
        "@aios/application/workflow에 @types/node 의존성을 정리하고 typecheck를 통과시킨다.",
      targetFiles: [
        "packages/application/workflow/tsconfig.json",
        "packages/application/workflow/package.json",
      ],
    },
    {
      title: "collaboration evidence 자동화 점검",
      description:
        "docs/evidence/<session-id>.md 생성 경로와 resume API 흐름을 점검한다.",
      targetFiles: [
        "packages/infrastructure/src/collaboration/evidence-writer.ts",
        "apps/web/src/app/api/collaboration/execute/route.ts",
      ],
    },
  ];

  await coordinator.addArtifact(SESSION_ID, {
    type: "plan",
    path: "docs/reports/cursor-opencode-collaboration.md",
    description: "Integration decomposition plan",
    createdAt: new Date(),
    metadata: { assignments: decomposition, plannedBy: "cursor" },
  });

  await coordinator.updateAssignment(SESSION_ID, planningAssignment.id, {
    status: "done",
    metadata: {
      completedAt: new Date().toISOString(),
      decompositionCount: decomposition.length,
    },
  });

  await coordinator.addHandoff(SESSION_ID, {
    from: "cursor",
    to: "opencode",
    reason: "contract-execution",
    summary:
      "Cursor가 연동 작업을 분해했고, opencode가 구현/검증 assignment를 수행한다.",
    metadata: { assignmentIds: decomposition.map((item) => item.title) },
  });

  const queuedAssignments = [];
  for (const item of decomposition) {
    const assignment = await coordinator.addAssignment(SESSION_ID, {
      title: item.title,
      description: item.description,
      assignedTo: "opencode",
      role: "implementer",
      targetFiles: item.targetFiles,
      metadata: { trigger: "cursor-decomposition", phase: "implementation" },
    });
    queuedAssignments.push(assignment);
  }

  await coordinator.addAssignment(SESSION_ID, {
    title: "Codex 보조 리뷰",
    description:
      "구현 결과를 리뷰하고 리팩토링 제안만 남긴다. 직접 구현은 하지 않는다.",
    assignedTo: "codex",
    role: "reviewer",
    targetFiles: ["docs/evidence/cursor-opencode-main-session.md"],
    metadata: { trigger: "cursor-decomposition", phase: "review" },
  });

  const verifyAssignment = queuedAssignments[0];
  await coordinator.updateAssignment(SESSION_ID, verifyAssignment.id, {
    status: "running",
  });

  const opencodeRuntime = createOpencodeRuntime(WORKSPACE_ROOT);
  await opencodeRuntime.initialize();
  const verifyJob = await opencodeRuntime.executeJob({
    taskId: verifyAssignment.id,
    agentType: "opencode",
    input: {
      task: `Run "pnpm test" in ${WORKSPACE_ROOT} and return only PASS or FAIL with a one-line summary.`,
      context: {
        sessionId: SESSION_ID,
        assignmentId: verifyAssignment.id,
        targetFiles: verifyAssignment.targetFiles,
      },
      constraints: ["no file modifications", "verification only"],
    },
  });
  await opencodeRuntime.shutdown();

  await coordinator.updateAssignment(SESSION_ID, verifyAssignment.id, {
    status: verifyJob.status === "completed" ? "done" : "failed",
    metadata: {
      jobId: verifyJob.id,
      summary:
        typeof verifyJob.output?.result === "string"
          ? verifyJob.output.result
          : verifyJob.error,
      completedAt: new Date().toISOString(),
    },
  });

  await coordinator.addArtifact(SESSION_ID, {
    type: verifyJob.status === "completed" ? "test-result" : "log",
    path: "",
    description: `opencode verification: ${verifyAssignment.title}`,
    createdAt: new Date(),
    metadata: {
      assignmentId: verifyAssignment.id,
      status: verifyJob.status,
      result: verifyJob.output?.result ?? verifyJob.error,
    },
  });

  const cursorRuntime = createCursorRuntime(WORKSPACE_ROOT);
  await cursorRuntime.initialize();
  const reviewJob = await cursorRuntime.executeJob({
    taskId: planningAssignment.id,
    agentType: "manual",
    input: {
      task: "Summarize collaboration contract execution status in 3 bullet points. No file edits.",
      context: { sessionId: SESSION_ID },
      constraints: ["read-only"],
    },
  });
  await cursorRuntime.shutdown();

  await coordinator.addArtifact(SESSION_ID, {
    type: "review",
    path: "",
    description: "Cursor orchestration summary",
    createdAt: new Date(),
    metadata: {
      summary:
        typeof reviewJob.output?.result === "string"
          ? reviewJob.output.result
          : reviewJob.error,
    },
  });

  const finalSession = await coordinator.getSession(SESSION_ID);
  const approvals = await approvalStore.list();
  if (finalSession) {
    const evidencePath = await evidenceWriter.writeSessionSummary(
      finalSession,
      approvals,
    );
    await mkdir(join(WORKSPACE_ROOT, "docs", "evidence"), { recursive: true });
    console.log(
      JSON.stringify(
        {
          ok: true,
          sessionId: SESSION_ID,
          sessionStatus: finalSession.status,
          evidencePath,
          assignments: finalSession.assignments.map((assignment) => ({
            id: assignment.id,
            title: assignment.title,
            assignedTo: assignment.assignedTo,
            status: assignment.status,
          })),
          handoffs: finalSession.handoffs.length,
          artifacts: finalSession.artifacts.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error("Failed to load final session state");
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(
    join(
      WORKSPACE_ROOT,
      "docs",
      "evidence",
      "cursor-opencode-main-session.error.json",
    ),
    `${JSON.stringify({ ok: false, error: message, at: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  console.error(message);
  process.exit(1);
});
