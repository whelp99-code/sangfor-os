#!/usr/bin/env node
/**
 * Performs the AC-DOD-09 staging verification and records what it actually ran.
 *
 * AC-DOD-09 is "staging 배포 검증". The campaign proves the staging environment
 * came up equivalent to production and leaves the verdict to a human; this runs
 * the checks that verdict should rest on and writes their real results in the
 * shape `sign-external-approval.mjs` will accept.
 *
 * It records only what happened. A command that fails is recorded as failing,
 * and the signer refuses to build an approval from it.
 *
 * Usage: node scripts/record-approval-commands.mjs --output <file.json>
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

/** The checks that stand behind a staging approval. */
export const APPROVAL_COMMANDS = [
  ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "node", "--test", "--test-concurrency=1", "scripts/verify-staging-equivalent.test.mjs"],
  ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "node", "--test", "--test-concurrency=1", "scripts/verify-acceptance.test.mjs"],
  ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "node", "--test", "--test-concurrency=1", "scripts/verify-production-readiness.test.mjs"],
];

/**
 * node:test's TAP-ish summary. Counting `# pass` rather than `ok` lines avoids
 * double-counting subtests, and a run that reports no total is treated as
 * proving nothing rather than as a pass.
 */
export function parseTestCount(stdout) {
  const pass = /^# pass (\d+)$/mu.exec(stdout);
  const fail = /^# fail (\d+)$/mu.exec(stdout);
  if (!pass || !fail) return null;
  if (Number(fail[1]) !== 0) return null;
  const count = Number(pass[1]);
  return count > 0 ? count : null;
}

export function runApprovalCommands(commands = APPROVAL_COMMANDS, run = spawnSync) {
  return commands.map((argv) => {
    const result = run(argv[0], argv.slice(1), { cwd: ROOT, encoding: "utf8", timeout: 1_800_000 });
    const stdout = result.stdout ?? "";
    const testCount = parseTestCount(stdout);
    return {
      argv,
      exitCode: result.status ?? 70,
      testCount: testCount ?? 0,
      stderrTail: (result.stderr ?? "").split("\n").slice(-5).join("\n"),
    };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[process.argv.indexOf("--output") + 1]);
  const results = runApprovalCommands();
  for (const result of results) {
    process.stdout.write(`  ${result.exitCode === 0 && result.testCount > 0 ? "PASS" : "FAIL"} ${result.testCount} tests  ${result.argv.slice(-1)[0]}\n`);
    if (result.exitCode !== 0) process.stderr.write(`${result.stderrTail}\n`);
  }
  writeFileSync(output, `${JSON.stringify(results.map(({ argv, exitCode, testCount }) => ({ argv, exitCode, testCount })), null, 2)}\n`, { mode: 0o600 });
  process.exit(results.every((result) => result.exitCode === 0 && result.testCount > 0) ? 0 : 65);
}
