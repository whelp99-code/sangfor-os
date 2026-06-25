/**
 * Cursor Agent dispatch helper.
 * Runs the installed Cursor Agent CLI against the current workspace.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCursorRuntime } from "../packages/infrastructure/src/agents/command-agent-runtime.ts";

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const promptArgs = process.argv.slice(2);
const prompt = (promptArgs[0] === "--" ? promptArgs.slice(1) : promptArgs)
  .join(" ")
  .trim();

async function main() {
  if (!prompt) {
    throw new Error('Usage: tsx scripts/dispatch-cursor-agent.ts "<prompt>"');
  }

  const runtime = createCursorRuntime(WORKSPACE_ROOT);
  await runtime.initialize();

  const job = await runtime.executeJob({
    taskId: `cursor-agent-${Date.now()}`,
    agentType: "manual",
    input: {
      task: prompt,
      context: {
        workspaceRoot: WORKSPACE_ROOT,
        command: "agent",
      },
      constraints: ["no file modifications unless explicitly requested"],
    },
  });

  await runtime.shutdown();

  console.log(
    JSON.stringify(
      {
        ok: job.status === "completed",
        status: job.status,
        command: job.metadata?.command,
        args: job.metadata?.args,
        output: job.output?.result ?? job.error ?? null,
      },
      null,
      2,
    ),
  );

  if (job.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
