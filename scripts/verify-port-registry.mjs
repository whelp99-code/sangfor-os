#!/usr/bin/env node
/**
 * U003 — run canonical @sangfor/config ports Vitest suite and require count > 0.
 * Invokes: corepack pnpm --filter @sangfor/config test -- src/ports.test.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "packages/config/src/ports.test.ts");

if (!existsSync(target)) {
  console.error(`verify-port-registry: missing canonical target ${target}`);
  process.exit(1);
}

const env = {
  ...process.env,
  NO_COLOR: "1",
  FORCE_COLOR: "0",
};

const result = spawnSync(
  "corepack",
  ["pnpm", "--filter", "@sangfor/config", "test", "--", "src/ports.test.ts"],
  {
    cwd: root,
    env,
    encoding: "utf8",
  },
);

const combined = `${result.stdout || ""}${result.stderr || ""}`;
// Strip ANSI SGR sequences before parsing.
const stripped = combined.replace(/\u001b\[[0-9;]*m/g, "");

if (result.status !== 0) {
  process.stdout.write(stripped);
  console.error(`verify-port-registry: child exited ${result.status ?? 1}`);
  process.exit(result.status ?? 1);
}

// Vitest summary lines look like: "Tests  4 passed (4)" or "✓ ... (4 tests)"
let passed = 0;
const m1 = stripped.match(/Tests\s+(\d+)\s+passed/i);
if (m1) {
  passed = Number(m1[1]);
} else {
  const m2 = stripped.match(/(\d+)\s+passed/i);
  if (m2) passed = Number(m2[1]);
}

if (!passed || passed <= 0) {
  process.stdout.write(stripped);
  console.error("verify-port-registry: parsed test count is 0");
  process.exit(1);
}

console.log(`verify-port-registry: ${passed} tests passed; target=${target}`);
process.exit(0);
