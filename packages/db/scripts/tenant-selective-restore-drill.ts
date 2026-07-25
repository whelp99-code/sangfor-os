#!/usr/bin/env tsx
/**
 * U074 — Tenant-Selective Restore Drill
 *
 * Fixture-only drill that exports a synthetic tenant scope from one isolated
 * Postgres 16 instance and imports it into another with deterministic ID
 * remapping. This is NOT a production restore tool.
 *
 * Usage: pnpm --filter @sangfor/db drill:tenant-restore
 */

import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

async function main() {
  console.log("[U074] Tenant-selective restore drill");
  console.log("[U074] This is a fixture-only drill — not a production restore tool.");
  console.log("[U074] Run with CI_INTEGRATION=1 for the full integration test.");
  console.log("[U074] See docs/12_VERIFICATION/tenant-selective-restore-drill.md for details.");

  if (process.env.DATABASE_URL) {
    console.error("[U074] FATAL: caller DATABASE_URL detected. This drill requires U009-owned scratch databases only.");
    process.exit(1);
  }

  if (process.env.DOCKER_HOST && process.env.DOCKER_HOST !== "") {
    console.error("[U074] FATAL: remote DOCKER_HOST detected. Loopback-only Docker required.");
    process.exit(1);
  }

  console.log("[U074] Safety checks passed. Run the integration test for the full drill:");
  console.log("  CI_INTEGRATION=1 pnpm --filter @sangfor/db exec vitest run src/tenant-restore/tenant-restore.integration.test.ts");
}

main().catch((err) => {
  console.error("[U074] Drill failed:", err);
  process.exit(1);
});
