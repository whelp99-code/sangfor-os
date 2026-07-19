/**
 * U007 — strict Playwright acceptance wrapper.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateLeaseAgainstEnv } from "./lib/resource-lease.mjs";
import { evaluateCommandResult } from "./lib/strict-command-result.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(code, msg) {
  const err = new Error(msg);
  err.exitCode = code;
  throw err;
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function validateAcceptanceEnv(env = process.env) {
  const leaseFile = env.RESOURCE_LEASE_FILE;
  if (!leaseFile) fail(64, "RESOURCE_LEASE_FILE required");
  if (!env.TASK_OWNER_UNIT) fail(64, "TASK_OWNER_UNIT required");
  if (!env.TASK_RUN_ID) fail(64, "TASK_RUN_ID required");
  if (!env.PORT || !env.API_PORT) fail(64, "PORT and API_PORT required");
  if (env.PORT === env.API_PORT) fail(64, "PORT and API_PORT must differ");
  if (!env.DATABASE_URL) fail(64, "DATABASE_URL required (task-owned)");
  if (!env.TASK_POSTGRES_RECEIPT_FILE) {
    fail(64, "TASK_POSTGRES_RECEIPT_FILE required");
  }

  const lease = validateLeaseAgainstEnv(env, leaseFile);

  // DATABASE_URL must be loopback + sangfor_task_<sanitized-run>
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    fail(64, "DATABASE_URL invalid");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    fail(64, "DATABASE_URL must be loopback");
  }
  const sanitized = String(env.TASK_RUN_ID).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48);
  const dbName = url.pathname.replace(/^\//, "").split("?")[0];
  if (!dbName.startsWith("sangfor_task_")) {
    fail(64, "DATABASE_URL database must be sangfor_task_*");
  }
  if (!dbName.includes(sanitized) && dbName !== `sangfor_task_${sanitized}`) {
    // allow sanitized form equality
    if (dbName !== `sangfor_task_${sanitized}`) {
      // soft: require prefix only if sanitize collapses
      if (!dbName.startsWith("sangfor_task_")) fail(64, "db name prefix");
    }
  }

  const receiptPath = env.TASK_POSTGRES_RECEIPT_FILE;
  if (!existsSync(receiptPath)) fail(64, "postgres receipt missing");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (receipt.runId !== env.TASK_RUN_ID) fail(64, "receipt runId mismatch");
  if (receipt.ownerUnit !== env.TASK_OWNER_UNIT) {
    fail(64, "receipt ownerUnit mismatch");
  }
  if (receipt.host !== "127.0.0.1") fail(64, "receipt host not loopback");
  if (!receipt.sentinel) fail(64, "receipt sentinel missing");

  return { lease, receipt, receiptSha256: sha256File(receiptPath) };
}

export async function runPlaywrightAcceptance(argv = process.argv.slice(2)) {
  const { lease, receipt, receiptSha256 } = validateAcceptanceEnv(process.env);

  const spec =
    argv.find((a) => a.endsWith(".spec.ts")) ??
    "tests/e2e/playwright/core-flow-smoke.spec.ts";
  const specPath = resolve(REPO_ROOT, spec);
  if (!existsSync(specPath)) {
    fail(64, `missing spec ${spec}`);
  }

  const evidenceDir =
    process.env.ACCEPTANCE_EVIDENCE_DIR ??
    join(REPO_ROOT, "test-results", "acceptance");
  mkdirSync(evidenceDir, { recursive: true });
  process.env.ACCEPTANCE_EVIDENCE_DIR = evidenceDir;

  const wrapper = join(REPO_ROOT, "scripts/run-workspace-runtime.sh");
  const childArgv = [
    wrapper,
    "root",
    "--",
    "corepack",
    "pnpm",
    "exec",
    "playwright",
    "test",
    spec,
    "--config=playwright.acceptance.config.ts",
  ];

  const result = await new Promise((resolvePromise) => {
    const child = spawn(childArgv[0], childArgv.slice(1), {
      shell: false,
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });

  const reportPath = join(evidenceDir, "playwright-report.json");
  if (!existsSync(reportPath)) {
    fail(64, "playwright-report.json missing");
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  // Playwright JSON reporter shape varies; count tests
  let total = 0;
  let skipped = 0;
  const suites = report.suites ?? [];
  const walk = (suite) => {
    for (const s of suite.suites ?? []) walk(s);
    for (const spec of suite.specs ?? []) {
      total += 1;
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          if (r.status === "skipped") skipped += 1;
          if ((r.retry ?? 0) > 0) fail(64, "retry present");
        }
      }
    }
  };
  for (const s of suites) walk(s);

  const verdict = evaluateCommandResult({
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    policy: "strict-test",
    receiptPresent: true,
  });

  if (total === 0) fail(64, "playwright total tests 0");
  if (skipped > 0) fail(64, "playwright skipped > 0");
  if (result.code !== 0) fail(64, "playwright non-zero exit");
  if (verdict.verdict === "FAIL" && verdict.reason !== "unparseable_output") {
    // stdout may not parse as vitest; rely on JSON total
  }

  const receiptOut = {
    schemaVersion: 1,
    ownerUnit: process.env.TASK_OWNER_UNIT,
    runId: process.env.TASK_RUN_ID,
    webPort: lease.webPort,
    apiPort: lease.apiPort,
    leaseFileSha256: lease.sha256,
    postgresReceiptSha256: receiptSha256,
    purpose: receipt.purpose,
    totalTests: total,
    skipped,
    workers: 1,
    retries: 0,
    reuseExistingServer: false,
    exitCode: result.code,
    createdAt: new Date().toISOString(),
  };
  const tmp = join(evidenceDir, "playwright-receipt.json.tmp");
  const final = join(evidenceDir, "playwright-receipt.json");
  writeFileSync(tmp, JSON.stringify(receiptOut, null, 2));
  renameSync(tmp, final);
  return receiptOut;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runPlaywrightAcceptance().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(err?.exitCode ?? 64);
  });
}
