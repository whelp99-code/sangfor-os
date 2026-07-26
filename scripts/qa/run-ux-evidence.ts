import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { prisma } from "@sangfor/db";

import { runPlaywrightAcceptance } from "../run-playwright-acceptance.mjs";
import { generateEvidenceReceipt } from "./verify-ux-evidence.mjs";
import { prepareUxFixtures } from "./prepare-ux-fixtures";

const FORBIDDEN_PREEXISTING_EVIDENCE = [
  "axe-results.json",
  "playwright-report.json",
  "playwright-receipt.json",
  "snapshot-digests.json",
];

function fail(message: string): never {
  const error = new Error(message) as Error & { exitCode?: number };
  error.exitCode = 64;
  throw error;
}

function readFixtureEnvironment(receiptFile: string): Record<string, string> {
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as {
    env?: Record<string, unknown>;
  };
  if (!receipt.env || typeof receipt.env !== "object") {
    fail("U066 fixture receipt is missing env");
  }

  return Object.fromEntries(
    Object.entries(receipt.env).map(([key, value]) => {
      if (typeof value !== "string" || value.length === 0) {
        fail(`U066 fixture receipt has invalid ${key}`);
      }
      return [key, value];
    }),
  );
}

export async function runUxEvidence(): Promise<void> {
  if (process.env.TASK_OWNER_UNIT !== "U066") {
    fail("TASK_OWNER_UNIT must be U066");
  }
  const evidenceDirectory = process.env.ACCEPTANCE_EVIDENCE_DIR?.trim();
  if (!evidenceDirectory) fail("ACCEPTANCE_EVIDENCE_DIR is required");
  const evidenceRoot = resolve(evidenceDirectory);
  for (const file of FORBIDDEN_PREEXISTING_EVIDENCE) {
    if (existsSync(join(evidenceRoot, file))) {
      fail(`refusing to overwrite existing U066 evidence: ${file}`);
    }
  }

  const applicationDatabaseUrl = process.env.TASK_OWNED_DATABASE_URL?.trim();
  const migrationDatabaseUrl = process.env.TASK_MIGRATION_DATABASE_URL?.trim();
  if (!applicationDatabaseUrl || !migrationDatabaseUrl) {
    fail("task-owned application and migration database URLs are required");
  }

  process.env.DATABASE_URL = migrationDatabaseUrl;
  process.env.TASK_OWNED_DATABASE_URL = migrationDatabaseUrl;
  process.env.UX_FIXTURE_OUTPUT_DIR = join(evidenceRoot, "fixtures");
  const fixtureArtifacts = await prepareUxFixtures(process.env);
  Object.assign(process.env, readFixtureEnvironment(fixtureArtifacts.receiptFile));
  process.env.DATABASE_URL = migrationDatabaseUrl;
  process.env.TASK_OWNED_DATABASE_URL = applicationDatabaseUrl;
  process.env.SANGFOR_APP_DATABASE_URL = applicationDatabaseUrl;

  const playwrightReceipt = await runPlaywrightAcceptance([
    "tests/e2e/playwright/ux-checkpoint.spec.ts",
  ]);
  if (playwrightReceipt.totalTests !== 195 || playwrightReceipt.skipped !== 0) {
    fail(`U066 Playwright inventory mismatch: ${playwrightReceipt.totalTests} total, ${playwrightReceipt.skipped} skipped`);
  }

  const receipt = generateEvidenceReceipt(join(evidenceRoot, "screenshots"), evidenceRoot);
  if (!receipt.overallPassed) {
    fail(`U066 evidence verification failed: ${JSON.stringify(receipt)}`);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

runUxEvidence()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = typeof error === "object" && error && "exitCode" in error
      ? Number((error as { exitCode: unknown }).exitCode)
      : 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
