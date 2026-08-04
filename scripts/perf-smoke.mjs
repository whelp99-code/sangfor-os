/** U075 isolated production performance orchestration. */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { withIsolatedPostgres } from "./lib/isolated-postgres.mjs";
import { validateLeaseAgainstEnv } from "./lib/resource-lease.mjs";
import { makeSanitizedProcessEnv } from "./lib/sanitized-process-env.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PURPOSE = "performance-smoke";
const activeProcesses = new Map();
let interruptedSignal = null;

function fail(message, exitCode = 64) {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
}

export function validateEnvironment(env = process.env) {
  for (const key of ["DATABASE_URL", "TASK_OWNED_DATABASE_URL", "TASK_POSTGRES_RECEIPT_FILE", "PERF_DATABASE_URL", "DOCKER_CONTEXT"]) {
    if (env[key]) fail(`caller ${key} detected — U075 rejects caller-provided database or Docker context`);
  }
  if (env.DOCKER_HOST) fail("remote DOCKER_HOST detected — default loopback-only Docker context required");
  for (const key of ["TASK_RUN_ID", "TASK_OWNER_UNIT", "PORT", "API_PORT", "ACCEPTANCE_EVIDENCE_DIR", "RESOURCE_LEASE_FILE"]) {
    if (!env[key]) fail(`missing required env: ${key}`);
  }
  if (env.TASK_OWNER_UNIT !== "U075") fail("TASK_OWNER_UNIT must equal U075");
  const ports = [env.PORT, env.API_PORT].map(Number);
  if (!ports.every((port) => Number.isInteger(port) && port > 0 && port < 65_536) || ports[0] === ports[1]) fail("PORT/API_PORT must be distinct integer ports");
  validateEvidenceBoundary(env.ACCEPTANCE_EVIDENCE_DIR, env.RESOURCE_LEASE_FILE);
  return { webPort: ports[0], apiPort: ports[1] };
}

export function validateEvidenceBoundary(evidenceDirRaw, leaseFileRaw) {
  if (!isAbsolute(evidenceDirRaw) || !isAbsolute(leaseFileRaw)) fail("evidence and lease paths must be absolute");
  const evidenceDir = resolve(evidenceDirRaw);
  const repositoryEvidenceRoot = resolve(REPO_ROOT, ".omo/evidence");
  const repositoryRelative = relative(repositoryEvidenceRoot, evidenceDir);
  const insideRepository = repositoryRelative !== "" && !repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative);
  const leaseFile = resolve(leaseFileRaw);
  const attemptRoot = dirname(dirname(leaseFile));
  const leaseBoundAlias = dirname(dirname(evidenceDir)) === attemptRoot
    && basename(dirname(evidenceDir)) === "aliases"
    && basename(dirname(leaseFile)) === "leases"
    && basename(evidenceDir) === "T-PERF";
  if (!insideRepository && !leaseBoundAlias) fail("ACCEPTANCE_EVIDENCE_DIR must be repository evidence or the lease-bound T-PERF alias directory");
}

export async function assertPortFree(port) {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", (error) => reject(error.code === "EADDRINUSE" ? new Error(`port ${port} occupied`) : error));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePromise(true)));
  });
}

export function validateHelperReceipt(receipt, expected = {}) {
  if (!receipt || typeof receipt !== "object") fail("invalid helper receipt");
  for (const key of ["runId", "ownerUnit", "purpose", "imageDigest", "sentinel"]) {
    if (!receipt[key]) fail(`invalid helper receipt: missing ${key}`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (receipt[key] !== value) fail(`helper receipt ${key} mismatch`);
  }
  if (receipt.sentinel.runId !== receipt.runId || receipt.sentinel.ownerUnit !== receipt.ownerUnit || receipt.sentinel.purpose !== receipt.purpose) fail("helper receipt sentinel mismatch");
}

export function validatePhaseTransition(state) {
  if (!state.phaseAComplete) fail("phase-A must complete before phase-B");
  if (!state.portsFree) fail("ports must be free before phase-B");
}

export function validatePhaseBConfig(config) {
  if (config.reuseExistingServer) fail("reuseExistingServer must be false in phase B");
}

export function validateNoPidOverlap(phaseAPids, phaseBPids) {
  const overlap = phaseAPids.filter((pid) => phaseBPids.includes(pid));
  if (overlap.length) fail(`PID overlap between phase A and B: ${overlap.join(", ")}`);
}

export function validatePortsFree(state) {
  if (!state.webPortFree || !state.apiPortFree) fail("both ports must be free");
}

function command(argv, { env, logFile, timeoutMs = 600_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const output = logFile ? createWriteStream(logFile, { flags: "a", mode: 0o600 }) : null;
    const child = spawn(argv[0], argv.slice(1), { cwd: REPO_ROOT, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; output?.write(chunk); process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; output?.write(chunk); process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      output?.end();
      if (interruptedSignal) return reject(Object.assign(new Error(`interrupted by ${interruptedSignal}`), { exitCode: 128 }));
      if (timedOut) return reject(Object.assign(new Error(`${argv.join(" ")} timed out after ${timeoutMs}ms`), { exitCode: 124 }));
      if (code !== 0) return reject(Object.assign(new Error(`${argv.join(" ")} failed (${code ?? signal}): ${stderr.slice(-2000)}`), { exitCode: code ?? 1 }));
      resolvePromise({ code, stdout, stderr });
    });
  });
}

function startService(name, argv, env, logFile) {
  const output = createWriteStream(logFile, { flags: "a", mode: 0o600 });
  const child = spawn(argv[0], argv.slice(1), { cwd: REPO_ROOT, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(output);
  child.stderr.pipe(output);
  activeProcesses.set(name, { child, output });
  return child.pid;
}

async function stopServices() {
  const records = [...activeProcesses.values()];
  for (const { child } of records) {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }
  await sleep(1_000);
  for (const { child, output } of records) {
    if (child.exitCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }
    output.end();
  }
  activeProcesses.clear();
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (interruptedSignal) fail(`interrupted by ${interruptedSignal}`, 128);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  fail(`timeout waiting for ${url}`, 66);
}

function jwtEnv() {
  const secretBase64Url = Buffer.alloc(32, 75).toString("base64url");
  return {
    USER_JWT_ACTIVE_KID: "u075-performance-key",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "28800",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({ version: "sangfor.user-jwt-keyring/v1", keys: [{ kid: "u075-performance-key", state: "active", secretBase64Url, activatedAt: "2026-01-01T00:00:00Z", demotedAt: null, verifyUntil: null, retiredAt: null }] }),
    AUTH_DEMO_PASSWORD: "u075-performance-password",
  };
}

function productionAuthEnv() {
  const activatedAt = "2026-01-01T00:00:00Z";
  const keyring = (kid, byte) => JSON.stringify({
    version: "sangfor.internal-principal-keyring/v1",
    keys: [{ kid, state: "active", secretBase64Url: Buffer.alloc(32, byte).toString("base64url"), activatedAt, demotedAt: null, verificationCutoff: null, retiredAt: null }],
  });
  return {
    API_KEY: "u075-operator-api-key-000000000",
    FINANCE_API_KEY: "u075-finance-api-key-000000000",
    SANGFOR_API_KEY: "u075-mcp-api-key-0000000000000",
    MCP_API_KEY: "u075-workflow-api-key-0000000000",
    SANGFOR_OPERATOR_PRINCIPAL_ID: "u075-operator",
    WHELP99_ENFORCE_SAFE_TOOLS: "true",
    INTERNAL_PRINCIPAL_TTL_SECONDS: "60",
    INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: "5",
    INTERNAL_PRINCIPAL_ROTATION_OWNER: "security-auth",
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: "finance",
    INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: keyring("finance", 1),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: "scheduler",
    INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: keyring("scheduler", 2),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: "workflow",
    INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: keyring("workflow", 3),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: "engineer",
    INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: keyring("engineer", 4),
  };
}

function loadImageDigest() {
  const perfLock = JSON.parse(readFileSync(join(REPO_ROOT, "tests/performance/postgres-image.json"), "utf8"));
  const canonicalLock = JSON.parse(readFileSync(join(REPO_ROOT, "scripts/fixtures/restore-drill/postgres16-image.lock.json"), "utf8"));
  if (perfLock.manifestListDigest !== canonicalLock.manifestListDigest || perfLock.resolvedImage !== canonicalLock.resolvedImage || perfLock.major !== canonicalLock.major) fail("performance Postgres lock does not match U009 canonical lock");
  return perfLock.manifestListDigest;
}

function validateBrowserReport(reportFile, expectedTests) {
  if (!existsSync(reportFile)) fail("Playwright performance report missing", 66);
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  let total = 0;
  let skipped = 0;
  const walk = (suite) => {
    for (const child of suite.suites ?? []) walk(child);
    for (const spec of suite.specs ?? []) {
      total += 1;
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status === "skipped") skipped += 1;
          if ((result.retry ?? 0) > 0) fail("Playwright performance retry detected", 66);
        }
      }
    }
  };
  for (const suite of report.suites ?? []) walk(suite);
  if (total !== expectedTests || skipped !== 0) fail(`Playwright performance coverage mismatch: total=${total} skipped=${skipped}`, 66);
  return { total, skipped };
}

async function main() {
  const { webPort, apiPort } = validateEnvironment();
  const lease = validateLeaseAgainstEnv(process.env, process.env.RESOURCE_LEASE_FILE);
  const runId = process.env.TASK_RUN_ID;
  const evidenceDir = resolve(process.env.ACCEPTANCE_EVIDENCE_DIR);
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  await Promise.all([assertPortFree(webPort), assertPortFree(apiPort)]);
  const imageDigest = loadImageDigest();
  const corpusFile = join(evidenceDir, "corpus-receipt.json");
  const phaseAResults = join(evidenceDir, "phase-a-measurements.json");
  const browserResults = join(evidenceDir, "browser-measurements.json");
  const reportFile = join(evidenceDir, "performance-report.json");
  const browserReportFile = join(evidenceDir, "playwright-performance-report.json");
  const processCleanupFile = join(evidenceDir, "process-cleanup.json");
  const phaseAPids = [];
  let runError = null;
  let browserReceipt = null;

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => { interruptedSignal = signal; void stopServices(); });

  try {
    await withIsolatedPostgres({ runId, ownerUnit: "U075", purpose: PURPOSE, evidenceDir, imageDigest, migrate: true, applicationRoleMode: "required" }, async (postgres) => {
    validateHelperReceipt(postgres.receipt, { runId, ownerUnit: "U075", purpose: PURPOSE, imageDigest });
    const explicit = {
      DATABASE_URL: postgres.migrationDatabaseUrl,
      TASK_OWNED_DATABASE_URL: postgres.taskOwnedDatabaseUrl,
      SANGFOR_APP_DATABASE_URL: postgres.taskOwnedDatabaseUrl,
      TASK_POSTGRES_RECEIPT_FILE: postgres.receiptPath,
      TASK_RUN_ID: runId,
      TASK_OWNER_UNIT: "U075",
      PORT: String(webPort),
      API_PORT: String(apiPort),
      RESOURCE_LEASE_FILE: process.env.RESOURCE_LEASE_FILE,
      ACCEPTANCE_EVIDENCE_DIR: evidenceDir,
      BASE_URL: `http://127.0.0.1:${webPort}`,
      API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      FINANCE_API_URL: `http://127.0.0.1:${apiPort}/api/cfo`,
      DEFAULT_PROJECT_ID: "u075-project",
      DEFAULT_PROJECT_SLUG: "demo-project",
      PERF_AUTH_EMAIL: "ceo@u075.test",
      CRM_CURSOR_SECRET: "u075-performance-cursor-secret-32-bytes",
      NEXT_TELEMETRY_DISABLED: "1",
      ...jwtEnv(),
      ...productionAuthEnv(),
    };
    const buildEnv = makeSanitizedProcessEnv({ explicit, lane: "build" });
    await command(["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "--filter", "@sangfor/api", "build"], { env: buildEnv, logFile: join(evidenceDir, "build-api.log") });
    await command(["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "--filter", "@sangfor/web", "build"], { env: buildEnv, logFile: join(evidenceDir, "build-web.log") });

    const runtimeEnv = makeSanitizedProcessEnv({ explicit: { ...explicit, NODE_ENV: "production" }, lane: "runtime" });
    await command(["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "exec", "tsx", "tests/performance/seed.ts"], { env: { ...runtimeEnv, PERF_CORPUS_RECEIPT_FILE: corpusFile }, logFile: join(evidenceDir, "seed.log") });

    phaseAPids.push(startService("api", ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "--filter", "@sangfor/api", "start"], runtimeEnv, join(evidenceDir, "phase-a-api.log")));
    phaseAPids.push(startService("web", ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "--filter", "@sangfor/web", "start"], runtimeEnv, join(evidenceDir, "phase-a-web.log")));
    try {
      await Promise.all([waitForHttp(`http://127.0.0.1:${apiPort}/api/health`, 180_000), waitForHttp(`http://127.0.0.1:${webPort}/login`, 300_000)]);
      await command(["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "exec", "tsx", "tests/performance/measure.ts"], { env: { ...runtimeEnv, PERF_CORPUS_RECEIPT_FILE: corpusFile, PERF_RESULTS_FILE: phaseAResults }, logFile: join(evidenceDir, "phase-a-measure.log") });
    } finally {
      await stopServices();
    }
    await Promise.all([assertPortFree(webPort), assertPortFree(apiPort)]);
    validatePhaseTransition({ phaseAComplete: existsSync(phaseAResults), portsFree: true });
    validatePhaseBConfig({ reuseExistingServer: false });
    validateNoPidOverlap(phaseAPids, phaseAPids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }));

    const playwrightEnv = makeSanitizedProcessEnv({ explicit: { ...explicit, NODE_ENV: "production" }, lane: "playwright" });
    await command(["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "exec", "playwright", "test", "--config=playwright.performance.config.ts"], { env: playwrightEnv, logFile: join(evidenceDir, "phase-b-playwright.log"), timeoutMs: 600_000 });
    browserReceipt = validateBrowserReport(browserReportFile, 19);
    await Promise.all([assertPortFree(webPort), assertPortFree(apiPort)]);
    validatePortsFree({ webPortFree: true, apiPortFree: true });
    await command(["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "exec", "tsx", "tests/performance/report.ts"], { env: { ...runtimeEnv, PERF_RESULTS_FILE: phaseAResults, PERF_BROWSER_RESULTS_FILE: browserResults, PERF_REPORT_FILE: reportFile }, logFile: join(evidenceDir, "report.log") });
    });
  } catch (error) {
    runError = error;
  } finally {
    await stopServices();
    let portsFree = false;
    try {
      await Promise.all([assertPortFree(webPort), assertPortFree(apiPort)]);
      portsFree = true;
    } catch (cleanupError) {
      if (!runError) runError = cleanupError;
    }
    if (!existsSync(processCleanupFile)) {
      writeFileSync(processCleanupFile, `${JSON.stringify({ status: portsFree ? "PASS" : "FAIL", phaseAPids, webPort, apiPort, portsFree, createdAt: new Date().toISOString() }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    }
  }

  const postgresCleanupFile = join(evidenceDir, "postgres-cleanup.json");
  const postgresCleanup = existsSync(postgresCleanupFile) ? JSON.parse(readFileSync(postgresCleanupFile, "utf8")) : null;
  const postgresPassed = postgresCleanup?.status === "PASS" && postgresCleanup.remainingLabelCount === 0;
  if (!postgresPassed && !runError) runError = Object.assign(new Error("Postgres cleanup receipt did not pass"), { exitCode: 68 });
  writeFileSync(join(evidenceDir, "u075-receipt.json"), `${JSON.stringify({
    schemaVersion: 1,
    unit: "U075",
    runId,
    leaseSha256: lease.sha256,
    result: runError ? "FAIL" : "PASS",
    report: existsSync(reportFile) ? "performance-report.json" : null,
    browser: browserReceipt,
    cleanup: { processes: JSON.parse(readFileSync(processCleanupFile, "utf8")).status, postgres: postgresPassed ? "PASS" : "FAIL" },
    error: runError instanceof Error ? runError.message : runError ? String(runError) : null,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  if (runError) throw runError;
  process.stdout.write(`[U075] PASS evidence=${evidenceDir}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch(async (error) => {
  await stopServices();
  process.stderr.write(`[U075] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(error?.exitCode ?? 1);
});
