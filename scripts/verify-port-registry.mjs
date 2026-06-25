#!/usr/bin/env node
/**
 * Validates PORT_REGISTRY uniqueness.
 * Run: pnpm integration:ports
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "tests/unit/port-registry.test.ts"],
  { cwd: root, stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 1);
