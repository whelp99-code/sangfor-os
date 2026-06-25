/**
 * Cursor → opencode fix directive dispatch
 * Source: docs/reports/cursor-to-opencode-fix-directive.md
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentSessionCoordinator } from "../packages/application/src/agents/session-coordinator.ts";
import { ApprovalFileStore } from "../packages/infrastructure/src/collaboration/approval-file-store.ts";
import { CollaborationEvidenceWriter } from "../packages/infrastructure/src/collaboration/evidence-writer.ts";
import { CollaborationSessionFileStore } from "../packages/infrastructure/src/collaboration/session-file-store.ts";
import { CommandAgentRuntime } from "../packages/infrastructure/src/agents/command-agent-runtime.ts";

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_ID = "cursor-opencode-main-session";
const HANDOFF_DOC = "docs/reports/cursor-to-opencode-fix-directive.md";

const OPENCODE_TASKS = [
  {
    title: "Task 1-3: test alias, approval body, action types",
    targetFiles: [
      "vitest.config.ts",
      "apps/web/src/lib/integrations/approval-middleware.ts",
      "packages/domain/src/models/approval-policy.ts",
      "packages/infrastructure/src/collaboration/approval-file-store.ts",
      "apps/web/src/app/api/approvals/route.ts",
    ],
    prompt: `Read ${HANDOFF_DOC} Tasks 1-3. Fix vitest @ alias, approval middleware body double-read, unified ApprovalActionType guards. Run pnpm test.`,
  },
  {
    title: "Task 4-6: proxy config, SSE, degraded health UI",
    targetFiles: [
      "packages/proxy-core/src/aios-v1-adapter.ts",
      "packages/health/src/registry.ts",
      "apps/web/src/app/settings/page.tsx",
      "apps/web/src/components/dashboard/dashboard.tsx",
    ],
    prompt: `Read ${HANDOFF_DOC} Tasks 4-6. Decouple AiosV1ProxyAdapter from full getConfig(), fix SSE stream encoding, show degraded integration health in Settings/Dashboard.`,
  },
  {
    title: "Task 7-10: settings dynamic, sangfor roadmap, lint, docs",
    targetFiles: [
      "apps/web/src/app/settings/page.tsx",
      "apps/web/src/app/api/sangfor/compliance/roadmap/route.ts",
      "docs/evidence/cursor-opencode-main-session.md",
    ],
    prompt: `Read ${HANDOFF_DOC} Tasks 7-10. Remove client dynamic export from settings page, add sangfor compliance roadmap route, fix pnpm lint/format issues, update evidence docs with real verification results. Run full verification commands from directive.`,
  },
];

function createOpencodeRuntime(cwd: string): CommandAgentRuntime {
  return new CommandAgentRuntime({
    agentType: "opencode",
    command: process.env.OPENCODE_COMMAND || "opencode",
    cwd,
    timeoutMs: 900_000,
    argsBuilder: (request) => ["run", request.input.task],
  });
}

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

  const session = await coordinator.getSession(SESSION_ID);
  if (!session) throw new Error(`Session not found: ${SESSION_ID}`);

  await coordinator.updateSession(SESSION_ID, {
    status: "in-progress",
    metadata: {
      ...session.metadata,
      phase: "fix-directive",
      lastOpencodeDispatchAt: new Date().toISOString(),
    },
  });

  await coordinator.addHandoff(SESSION_ID, {
    from: "cursor",
    to: "opencode",
    reason: "codex-fix-directive",
    summary: "Cursor가 Codex 리뷰 기반 10개 수정 태스크를 opencode에 지시한다.",
  });

  const results: Array<{ title: string; status: string }> = [];

  for (const task of OPENCODE_TASKS) {
    const assignment = await coordinator.addAssignment(SESSION_ID, {
      title: task.title,
      description: task.prompt,
      assignedTo: "opencode",
      role: "implementer",
      targetFiles: task.targetFiles,
      metadata: { trigger: "fix-directive-dispatch", handoffDoc: HANDOFF_DOC },
    });

    await coordinator.updateAssignment(SESSION_ID, assignment.id, {
      status: "running",
    });
    console.error(`[dispatch] ${task.title}`);

    const runtime = createOpencodeRuntime(WORKSPACE_ROOT);
    await runtime.initialize();
    const job = await runtime.executeJob({
      taskId: assignment.id,
      agentType: "opencode",
      input: { task: task.prompt, context: { handoffDoc: HANDOFF_DOC } },
    });
    await runtime.shutdown();

    await coordinator.updateAssignment(SESSION_ID, assignment.id, {
      status: job.status === "completed" ? "done" : "failed",
    });
    results.push({ title: task.title, status: job.status });
  }

  const finalSession = await coordinator.getSession(SESSION_ID);
  const approvals = await approvalStore.list();
  const evidencePath = finalSession
    ? await evidenceWriter.writeSessionSummary(finalSession, approvals)
    : "";
  await mkdir(join(WORKSPACE_ROOT, "docs", "evidence"), { recursive: true });

  console.log(
    JSON.stringify(
      {
        ok: results.every((r) => r.status === "completed"),
        results,
        evidencePath,
      },
      null,
      2,
    ),
  );
  if (!results.every((r) => r.status === "completed")) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
