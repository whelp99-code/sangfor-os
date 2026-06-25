/**
 * Cursor → opencode Phase 7 remediation dispatch
 * Source: docs/reports/phase7-final-report.md verification audit (2026-06-13)
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
const PLAYGROUND = dirname(WORKSPACE_ROOT);
const SESSION_ID = "cursor-opencode-main-session";
const AUDIT_DOC = "docs/reports/phase7-final-report.md";

interface OpencodeTask {
  title: string;
  cwd: string;
  targetFiles: string[];
  prompt: string;
}

const OPENCODE_TASKS: OpencodeTask[] = [
  {
    title: "Phase 7 report correction + AIOSv2 commit readiness",
    cwd: WORKSPACE_ROOT,
    targetFiles: [
      AUDIT_DOC,
      "docs/evidence/cursor-opencode-main-session.md",
      "docs/reports/phase6-progress-report.md",
      "apps/web/src/lib/integrations/approval-middleware.ts",
      "tests/approval-gate.test.ts",
    ],
    prompt: `Phase 7 remediation — AIOSv2 (Cursor verification audit 2026-06-13).

Workspace: ${WORKSPACE_ROOT}

Problems found:
- phase7-final-report.md overstates 69/69 tests, AIOSv2 commit SHA (says 0c90b6e, HEAD is fb64e95+), and "운영 준비" without caveats.
- Uncommitted Codex follow-up changes may exist — ensure changed-file-only Prettier passes before commit.

Required:
1. Update ${AUDIT_DOC} section 2/4/7 with verified numbers: AIOSv2 pnpm test = 26/26, HEAD fb64e95, repo-wide format:check FAIL (legacy), changed-file Prettier PASS, build PASS with NFT warning.
2. Replace "100% operational ready" with scoped claim: build/TS gate green; portal integration still partial per product-integration-blueprint-status.md.
3. Re-run and record: pnpm test, pnpm lint, pnpm typecheck, pnpm --filter @aios/web build, git diff --check, changed-file-only prettier check.
4. Do NOT commit unless user explicitly requests — prepare clean staging list only.`,
  },
  {
    title: "Sangfor LM Studio test stability",
    cwd: join(PLAYGROUND, "sangfor-mcp-workflow"),
    targetFiles: ["tests/ai-workflow.test.ts"],
    prompt: `Phase 7 remediation — Sangfor MCP flaky tests.

Workspace: ${join(PLAYGROUND, "sangfor-mcp-workflow")}

Problem: pnpm test intermittently fails 42/44 when LM Studio is slow/unavailable (getCurrentModel / timeouts).

Required:
1. Use isLmStudioReady() guard on ALL tests that require live LM Studio (including getCurrentModel).
2. Prefer test.skip() or early return with explicit skip log when LM Studio unavailable — no assertion failures on missing model.
3. Verify: pnpm test passes with LM Studio off AND with LM Studio on (44/44 or documented skips).`,
  },
  {
    title: "VibeCodingOS i18n MISSING_MESSAGE cleanup",
    cwd: join(PLAYGROUND, "vibe-coding-os"),
    targetFiles: [
      "messages/ko.json",
      "messages/en.json",
      "app/[locale]/projects/new/page.tsx",
      "app/[locale]/projects/page.tsx",
    ],
    prompt: `Phase 7 remediation — VibeCodingOS build warnings.

Workspace: ${join(PLAYGROUND, "vibe-coding-os")}

Problem: pnpm build succeeds but SSG logs MISSING_MESSAGE for projects.create.*, common.backToList, projects.subtitle, common.loading (ko + en).

Required:
1. Add all missing keys to messages/ko.json and messages/en.json (match keys used in projects/new and projects pages).
2. Re-run pnpm build — zero MISSING_MESSAGE errors during static generation.
3. ignoreBuildErrors must remain removed.`,
  },
  {
    title: "Mail Intelligence verification script",
    cwd: join(PLAYGROUND, "apps/mail-intelligence"),
    targetFiles: ["server.mjs", "package.json", "README.md"],
    prompt: `Phase 7 remediation — Mail Intelligence reproducible health check.

Workspace: ${join(PLAYGROUND, "apps/mail-intelligence")}

Problem: phase7 report claims port 10200 API verified but server was not running at re-audit time.

Required:
1. Add scripts/verify-health.mjs (or package.json script) that: node --check server.mjs, optionally curl /api/outlook/status with timeout, documents port 10200 vs MAIL_INTELLIGENCE_URL 3010.
2. Update README with verify command.
3. Do not claim PASS unless script exits 0.`,
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
      phase: "phase7-remediation",
      lastOpencodeDispatchAt: new Date().toISOString(),
    },
  });

  await coordinator.addHandoff(SESSION_ID, {
    from: "cursor",
    to: "opencode",
    reason: "phase7-verification-audit",
    summary:
      "Cursor가 phase7-final-report 검증 감사 결과 4건을 opencode에 수정 지시한다.",
  });

  const results: Array<{ title: string; status: string; cwd: string }> = [];

  for (const task of OPENCODE_TASKS) {
    const assignment = await coordinator.addAssignment(SESSION_ID, {
      title: task.title,
      description: task.prompt,
      assignedTo: "opencode",
      role: "implementer",
      targetFiles: task.targetFiles,
      metadata: {
        trigger: "phase7-remediation-dispatch",
        cwd: task.cwd,
        auditDoc: AUDIT_DOC,
      },
    });

    await coordinator.updateAssignment(SESSION_ID, assignment.id, {
      status: "running",
    });
    console.error(`[dispatch] opencode (${task.cwd}): ${task.title}`);

    const runtime = createOpencodeRuntime(task.cwd);
    await runtime.initialize();
    const job = await runtime.executeJob({
      taskId: assignment.id,
      agentType: "opencode",
      input: {
        task: task.prompt,
        context: {
          sessionId: SESSION_ID,
          assignmentId: assignment.id,
          cwd: task.cwd,
          targetFiles: task.targetFiles,
        },
        constraints: [
          "implement in specified cwd",
          "run verification commands",
        ],
      },
    });

    const status = job.status === "completed" ? "completed" : "failed";
    await coordinator.updateAssignment(SESSION_ID, assignment.id, { status });
    results.push({ title: task.title, status, cwd: task.cwd });
    console.error(`[dispatch] ${task.title}: ${status}`);
  }

  await mkdir(join(WORKSPACE_ROOT, "docs", "evidence"), { recursive: true });
  await evidenceWriter.writeDispatchSummary({
    sessionId: SESSION_ID,
    title: "phase7-remediation-opencode-dispatch",
    results,
  });

  console.log(JSON.stringify({ sessionId: SESSION_ID, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
