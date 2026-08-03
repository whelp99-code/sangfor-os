import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { withIsolatedPostgres, DEFAULT_LOCK } from "./lib/isolated-postgres.mjs";
import { makeSanitizedProcessEnv } from "./lib/sanitized-process-env.mjs";
import { runPlaywrightAcceptance } from "./run-playwright-acceptance.mjs";
import { validateFinalAliasLeaseMap, validateLeasePathBoundaries } from "./run-test-alias.mjs";
import { verifyAcceptanceSet } from "./verify-acceptance.mjs";
import { verifyStagingEquivalentSet } from "./verify-staging-equivalent.mjs";

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const CONTEXT_KEYS = [
  "candidateSha",
  "childEnvKeySetHash",
  "createdAt",
  "detached",
  "envCheckpointHash",
  "mirrorHead",
  "mirrorPath",
  "mode",
  "ownerUnit",
  "receiptSchemaHash",
  "runId",
  "schemaVersion",
  "sourceStatus",
];

export class FinalAcceptanceError extends Error {}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function validateFinalMirrorInvocation({
  context,
  contextFile,
  contextHash,
  cwd,
  scriptPath,
  headSha,
  status,
  envFiles,
}) {
  const attemptRoot = path.dirname(context?.mirrorPath ?? "");
  if (
    !context ||
    !same(Object.keys(context).sort(), CONTEXT_KEYS) ||
    context.schemaVersion !== 1 ||
    context.mode !== "u076-final-aliases" ||
    context.ownerUnit !== "U076" ||
    context.detached !== true ||
    context.sourceStatus !== "clean"
  ) {
    throw new FinalAcceptanceError("invalid U007 detached mirror context");
  }
  if (
    !SHA40.test(context.candidateSha ?? "") ||
    context.mirrorHead !== context.candidateSha ||
    headSha !== context.candidateSha
  ) {
    throw new FinalAcceptanceError("candidate SHA differs from detached mirror HEAD");
  }
  if (
    cwd !== context.mirrorPath ||
    scriptPath !== path.join(context.mirrorPath, "scripts/run-final-acceptance.mjs") ||
    contextFile !== path.join(attemptRoot, "detached-release-mirror-context.json") ||
    status !== "" ||
    !Array.isArray(envFiles) ||
    envFiles.length !== 0
  ) {
    throw new FinalAcceptanceError("authoritative execution requires the clean detached mirror");
  }
  if (
    !SHA64.test(contextHash ?? "") ||
    ![context.envCheckpointHash, context.childEnvKeySetHash, context.receiptSchemaHash]
      .every((value) => SHA64.test(value ?? ""))
  ) {
    throw new FinalAcceptanceError("mirror context hashes invalid");
  }
  return Object.freeze({ ...context, contextFile, contextHash });
}

export async function runFinalAcceptanceCore({
  candidateSha,
  runId,
  manifestRows,
  aliasEntries,
  runStaging,
  writeManualPending,
  runAlias,
}) {
  if (!SHA40.test(candidateSha ?? "") || typeof runId !== "string" || runId.length === 0) {
    throw new FinalAcceptanceError("candidate SHA and runId are required");
  }
  const staging = await runStaging();
  if (staging?.result !== "PASS") throw new FinalAcceptanceError("staging-equivalent rehearsal failed");
  const manualReceipt = await writeManualPending();
  const aliasReceipts = [];
  for (const entry of aliasEntries) {
    aliasReceipts.push(await runAlias(entry));
  }
  return verifyAcceptanceSet({
    candidateSha,
    manifestRows,
    aliasEntries,
    aliasReceipts,
    manualReceipt,
  });
}

function productionAuthEnvironment() {
  const activatedAt = "2026-01-01T00:00:00Z";
  const keyring = (kid, byte) => JSON.stringify({
    version: "sangfor.internal-principal-keyring/v1",
    keys: [{
      kid,
      state: "active",
      secretBase64Url: Buffer.alloc(32, byte).toString("base64url"),
      activatedAt,
      demotedAt: null,
      verificationCutoff: null,
      retiredAt: null,
    }],
  });
  const userSecret = Buffer.alloc(32, 91).toString("base64url");
  return {
    API_KEY: "u076-operator-api-key-000000000",
    FINANCE_API_KEY: "u076-finance-api-key-000000000",
    SANGFOR_API_KEY: "u076-mcp-api-key-0000000000000",
    MCP_API_KEY: "u076-workflow-api-key-0000000000",
    SANGFOR_OPERATOR_PRINCIPAL_ID: "u076-operator",
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
    USER_JWT_ACTIVE_KID: "u076-release-key",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "900",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [{
        kid: "u076-release-key",
        state: "active",
        secretBase64Url: userSecret,
        activatedAt,
        demotedAt: null,
        verifyUntil: null,
        retiredAt: null,
      }],
    }),
    AUTH_DEMO_PASSWORD: "u076-release-password",
  };
}

function spawnCommand(argv, { cwd, env, stream = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stream) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stream) process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ code: code ?? 1, signal, stdout, stderr }));
  });
}

function startService(argv, { cwd, env }) {
  return spawn(argv[0], argv.slice(1), {
    cwd,
    env,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopServices(children) {
  for (const child of children) {
    if (child.exitCode === null) {
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
    }
  }
  await sleep(750);
  for (const child of children) {
    if (child.exitCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }
  }
}

async function assertPortFree(port) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}

async function waitForHttp(url, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response.status;
    } catch {}
    await sleep(250);
  }
  throw new FinalAcceptanceError(`timeout waiting for ${url}`);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function fixtureEnvironment(receipt) {
  if (!receipt?.env || typeof receipt.env !== "object") {
    throw new FinalAcceptanceError("U076 fixture receipt is missing environment");
  }
  return Object.fromEntries(Object.entries(receipt.env).map(([key, value]) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new FinalAcceptanceError(`U076 fixture environment ${key} invalid`);
    }
    return [key, value];
  }));
}

export async function runStagingEquivalent({
  mirrorRoot,
  candidateSha,
  runId,
  attemptDir,
  webPort,
  apiPort,
  resourceLeaseFile,
}) {
  await Promise.all([assertPortFree(webPort), assertPortFree(apiPort)]);
  const evidenceDir = path.join(attemptDir, "staging");
  const browserDir = path.join(evidenceDir, "browser");
  const postgresDir = path.join(evidenceDir, "postgres");
  await mkdir(browserDir, { recursive: true, mode: 0o700 });
  const imageLock = JSON.parse(await readFile(path.join(mirrorRoot, path.relative(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), DEFAULT_LOCK)), "utf8"));
  const auth = productionAuthEnvironment();
  let phaseA;
  let phaseB;

  const callbackResult = await withIsolatedPostgres({
    runId,
    ownerUnit: "U076",
    purpose: "final-staging-equivalent",
    evidenceDir: postgresDir,
    imageDigest: imageLock.manifestListDigest,
    migrate: true,
    applicationRoleMode: "required",
    repoRoot: mirrorRoot,
  }, async (postgres) => {
    const base = makeSanitizedProcessEnv({ lane: "generic", explicit: {
      ...auth,
      TASK_RUN_ID: runId,
      TASK_OWNER_UNIT: "U076",
      PORT: String(webPort),
      API_PORT: String(apiPort),
      RESOURCE_LEASE_FILE: resourceLeaseFile,
      TASK_POSTGRES_RECEIPT_FILE: postgres.receiptPath,
      ACCEPTANCE_EVIDENCE_DIR: browserDir,
    } });
    const fixtureDir = path.join(path.dirname(postgres.receiptPath), "fixtures");

    // The builds consume no UX_FIXTURE_* values (they only matter to the
    // running services and the playwright specs), so they run first: the
    // fixture session TTL is only 15 minutes from issuance, and preparing the
    // fixtures before the builds let that window expire mid-build on a loaded
    // host, which bounced all 30 release specs to /login on candidate
    // d3c3c021 (builds took 16.4 minutes there). Building first means the TTL
    // starts when the services actually come up.
    const buildEnv = {
      ...base,
      NODE_ENV: "production",
      DATABASE_URL: postgres.migrationDatabaseUrl,
      TASK_OWNED_DATABASE_URL: postgres.databaseUrl,
      SANGFOR_APP_DATABASE_URL: postgres.databaseUrl,
    };
    for (const argv of [
      ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "--filter", "@sangfor/api", "build"],
      ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "--filter", "@sangfor/web", "build"],
    ]) {
      const build = await spawnCommand(argv, { cwd: mirrorRoot, env: buildEnv, stream: true });
      if (build.code !== 0) throw new FinalAcceptanceError(`staging build failed: ${build.stderr.slice(-2000)}`);
    }

    const fixture = await spawnCommand(
      ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "prepare:ux-fixtures"],
      {
        cwd: mirrorRoot,
        env: {
          ...base,
          NODE_ENV: "test",
          DATABASE_URL: postgres.migrationDatabaseUrl,
          TASK_OWNED_DATABASE_URL: postgres.migrationDatabaseUrl,
          UX_FIXTURE_MODE: "u076-final",
          UX_FIXTURE_OUTPUT_DIR: fixtureDir,
        },
        stream: true,
      },
    );
    if (fixture.code !== 0) throw new FinalAcceptanceError(`fixture preparation failed: ${fixture.stderr.slice(-2000)}`);
    const fixtureReceipt = JSON.parse(await readFile(path.join(fixtureDir, "ux-fixtures-receipt.json"), "utf8"));
    const runtimeEnv = {
      ...base,
      ...fixtureEnvironment(fixtureReceipt),
      NODE_ENV: "production",
      DATABASE_URL: postgres.migrationDatabaseUrl,
      TASK_OWNED_DATABASE_URL: postgres.databaseUrl,
      SANGFOR_APP_DATABASE_URL: postgres.databaseUrl,
    };

    const phaseAChildren = [
      startService(["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "--filter", "@sangfor/api", "start"], { cwd: mirrorRoot, env: runtimeEnv }),
      startService(["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "--filter", "@sangfor/web", "start"], { cwd: mirrorRoot, env: runtimeEnv }),
    ];
    try {
      const [apiStatus, webStatus] = await Promise.all([
        waitForHttp(`http://127.0.0.1:${apiPort}/api/health`),
        waitForHttp(`http://127.0.0.1:${webPort}`),
      ]);
      phaseA = {
        candidateSha,
        runId,
        ownerUnit: "U076",
        webPort,
        apiPort,
        health: { web: webStatus, api: apiStatus },
        cleanup: { result: "PENDING", processes: phaseAChildren.length, portsFree: false },
      };
    } finally {
      await stopServices(phaseAChildren);
    }
    await Promise.all([assertPortFree(webPort), assertPortFree(apiPort)]);
    phaseA.cleanup = { result: "PASS", processes: 0, portsFree: true };
    await writeJson(path.join(attemptDir, "staging-phase-a-listeners.json"), phaseA);
    await writeJson(path.join(attemptDir, "staging-phase-a-port-release.json"), phaseA.cleanup);

    const previous = process.env;
    process.env = { ...runtimeEnv };
    let playwrightReceipt;
    try {
      playwrightReceipt = await runPlaywrightAcceptance([
        "tests/e2e/playwright/release-acceptance.spec.ts",
      ]);
    } finally {
      process.env = previous;
    }
    const surfaceReceipt = JSON.parse(await readFile(path.join(browserDir, "release-surface.json"), "utf8"));
    const totals = surfaceReceipt.results.reduce((accumulator, result) => ({
      axeViolations: accumulator.axeViolations + result.axeViolations,
      keyboardFailures: accumulator.keyboardFailures + result.keyboardFailures,
      consoleErrors: accumulator.consoleErrors + result.consoleErrors,
      networkErrors: accumulator.networkErrors + result.networkErrors,
    }), { axeViolations: 0, keyboardFailures: 0, consoleErrors: 0, networkErrors: 0 });
    phaseB = {
      candidateSha,
      runId,
      ownerUnit: "U076",
      webPort,
      apiPort,
      playwright: {
        exitCode: playwrightReceipt.exitCode,
        totalTests: playwrightReceipt.totalTests,
        skipped: playwrightReceipt.skipped,
        retries: playwrightReceipt.retries,
        workers: playwrightReceipt.workers,
        reuseExistingServer: playwrightReceipt.reuseExistingServer,
      },
      surface: { widths: surfaceReceipt.widths, ...totals },
      cleanup: { result: "PENDING", processes: 0, portsFree: true, databases: 1 },
    };
    return { phaseA, phaseB };
  });

  await Promise.all([assertPortFree(webPort), assertPortFree(apiPort)]);
  phaseB = callbackResult.phaseB;
  phaseB.cleanup = { result: "PASS", processes: 0, portsFree: true, databases: 0 };
  await writeJson(path.join(attemptDir, "staging-phase-b-listeners.json"), phaseB);
  const result = verifyStagingEquivalentSet({ candidateSha, runId, phaseA: callbackResult.phaseA, phaseB });
  await writeJson(path.join(attemptDir, "staging-equivalent.json"), result);
  return result;
}

function aliasNeedsDatabase(entry) {
  return entry.steps.some((step) =>
    Object.values(step.env).some((descriptor) =>
      descriptor?.from === "TASK_OWNED_DATABASE_URL" ||
      descriptor?.from === "TASK_POSTGRES_RECEIPT_FILE"));
}

async function prepareAliasUxFixtures({ mirrorRoot, entry, lease, postgres, environment }) {
  if (!["T-CRM", "T-UX"].includes(entry.alias)) return {};
  const fixtureDir = path.join(path.dirname(postgres.receiptPath), "fixtures");
  const fixture = await spawnCommand(
    ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "prepare:ux-fixtures"],
    {
      cwd: mirrorRoot,
      env: {
        ...environment,
        NODE_ENV: "test",
        DATABASE_URL: postgres.migrationDatabaseUrl,
        TASK_OWNED_DATABASE_URL: postgres.migrationDatabaseUrl,
        TASK_POSTGRES_RECEIPT_FILE: postgres.receiptPath,
        TASK_RUN_ID: lease.runId,
        TASK_OWNER_UNIT: entry.executionOwnerUnit,
        ...(entry.alias === "T-CRM" ? { UX_FIXTURE_MODE: "u043-crm" } : {}),
        UX_FIXTURE_OUTPUT_DIR: fixtureDir,
      },
      stream: true,
    },
  );
  if (fixture.code !== 0) throw new FinalAcceptanceError(`${entry.alias} fixture preparation failed: ${fixture.stderr.slice(-2000)}`);
  return fixtureEnvironment(JSON.parse(await readFile(path.join(fixtureDir, "ux-fixtures-receipt.json"), "utf8")));
}

async function readAliasStepResults(entry, evidenceDir) {
  return Promise.all(entry.steps.map(async (step) =>
    JSON.parse(await readFile(path.join(evidenceDir, "steps", step.id, "result.json"), "utf8"))));
}

async function hashAliasArtifacts(entry, evidenceDir, stepResults) {
  const relativePaths = new Set();
  for (const step of entry.steps) {
    relativePaths.add(path.join("steps", step.id, "result.json"));
  }
  for (const result of stepResults) {
    for (const output of result.declaredOutputs ?? []) relativePaths.add(output.path);
    if (typeof result.stdout?.path === "string") relativePaths.add(result.stdout.path);
    if (typeof result.stderr?.path === "string") relativePaths.add(result.stderr.path);
  }
  if (entry.alias === "T-CRM") relativePaths.add("t-crm-closure.json");
  return Promise.all([...relativePaths].sort().map(async (relativePath) => {
    if (path.isAbsolute(relativePath) || path.normalize(relativePath) !== relativePath) {
      throw new FinalAcceptanceError(`${entry.alias} artifact path invalid`);
    }
    const absolutePath = path.resolve(evidenceDir, relativePath);
    const relative = path.relative(path.resolve(evidenceDir), absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new FinalAcceptanceError(`${entry.alias} artifact path escapes evidence directory`);
    }
    const bytes = await readFile(absolutePath);
    if (bytes.length === 0) throw new FinalAcceptanceError(`${entry.alias} artifact is empty`);
    return { path: relativePath, sha256: hash(bytes), bytes: bytes.length };
  }));
}

export async function runFinalAlias({
  mirrorRoot,
  candidateSha,
  contextFile,
  contextHash,
  aliasMapFile,
  entry,
  lease,
  imageDigest,
}) {
  const common = makeSanitizedProcessEnv({ lane: "generic", explicit: {
    ...productionAuthEnvironment(),
    CI_INTEGRATION: "1",
    FINAL_CANDIDATE_SHA: candidateSha,
    FINAL_ALIAS_LEASE_MAP: aliasMapFile,
  } });
  const projection = {
    candidateSha,
    contextFile,
    contextHash,
    cwd: mirrorRoot,
    detached: true,
    envFiles: [],
    headSha: candidateSha,
    mirrorRoot,
    mode: "u076-final-aliases",
    scriptPath: path.join(mirrorRoot, "scripts/run-test-alias.mjs"),
    status: "",
  };
  const execute = async (databaseEnvironment = {}) => {
    const environment = {
      ...common,
      ...databaseEnvironment,
      DETACHED_RELEASE_MIRROR_CONTEXT: JSON.stringify(projection),
    };
    const result = await spawnCommand(
      ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "node", "scripts/run-test-alias.mjs", "--alias", entry.alias],
      { cwd: mirrorRoot, env: environment, stream: true },
    );
    if (result.code !== 0) throw new FinalAcceptanceError(`${entry.alias} failed: ${result.stderr.slice(-3000)}`);
  };

  if (aliasNeedsDatabase(entry)) {
    await withIsolatedPostgres({
      runId: lease.runId,
      ownerUnit: entry.executionOwnerUnit,
      purpose: "final-alias",
      evidenceDir: path.join(lease.evidenceDir, "postgres"),
      imageDigest,
      migrate: true,
      applicationRoleMode: "required",
      repoRoot: mirrorRoot,
    }, async (postgres) => {
      const fixture = await prepareAliasUxFixtures({ mirrorRoot, entry, lease, postgres, environment: common });
      await execute({
        ...fixture,
        TASK_OWNED_DATABASE_URL: postgres.migrationDatabaseUrl,
        SANGFOR_APP_DATABASE_URL: postgres.databaseUrl,
        TASK_POSTGRES_RECEIPT_FILE: postgres.receiptPath,
      });
    });
  } else {
    await execute();
  }
  const stepResults = await readAliasStepResults(entry, lease.evidenceDir);
  const stepResultHashes = await Promise.all(entry.steps.map(async (step) => ({
    id: step.id,
    sha256: hash(await readFile(path.join(lease.evidenceDir, "steps", step.id, "result.json"))),
  })));
  const artifactHashes = await hashAliasArtifacts(entry, lease.evidenceDir, stepResults);
  const receipt = {
    schemaVersion: 1,
    alias: entry.alias,
    owner: entry.owner,
    executionOwnerUnit: entry.executionOwnerUnit,
    candidateSha,
    runId: lease.runId,
    manifestRowIds: entry.manifestRowIds.filter((id) => id !== "AC-DOD-09"),
    stepResultHashes,
    artifactHashes,
    testCount: stepResults.reduce((total, step) => total + step.testCount, 0),
    skipped: stepResults.reduce((total, step) => total + step.skipped, 0),
    result: "PASS",
    databaseProvisioned: aliasNeedsDatabase(entry),
    cleanup: { result: "PASS", resources: 0 },
    createdAt: new Date().toISOString(),
  };
  await writeJson(path.join(lease.evidenceDir, "receipt.json"), receipt);
  await writeJson(path.join(lease.evidenceDir, "database.json"), {
    databaseProvisioned: aliasNeedsDatabase(entry),
    cleanup: { result: "PASS", resources: 0 },
  });
  return receipt;
}

function parseArgs(argv) {
  if (argv.length === 0) return {};
  if (
    argv.length !== 4 ||
    argv[0] !== "--mirror-context-file" ||
    argv[2] !== "--mirror-context-sha256"
  ) {
    throw new FinalAcceptanceError(
      "only --mirror-context-file FILE --mirror-context-sha256 HASH is allowed",
    );
  }
  return { contextFile: path.resolve(argv[1]), contextHash: argv[3] };
}

async function authoritativeContext(args) {
  const bytes = await readFile(args.contextFile);
  if (hash(bytes) !== args.contextHash) throw new FinalAcceptanceError("mirror context hash mismatch");
  const context = JSON.parse(bytes.toString("utf8"));
  const cwd = await realpath(process.cwd());
  const scriptPath = await realpath(fileURLToPath(import.meta.url));
  const { spawnSync } = await import("node:child_process");
  const git = (gitArgs) => spawnSync("git", gitArgs, { cwd, encoding: "utf8", env: { PATH: process.env.PATH } });
  const head = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const branch = git(["symbolic-ref", "--quiet", "HEAD"]);
  const ignored = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--", ".env*", "**/.env*"]);
  if (head.status !== 0 || status.status !== 0 || branch.status !== 1 || ignored.status !== 0) {
    throw new FinalAcceptanceError("Git detached mirror revalidation failed");
  }
  const envFiles = ignored.stdout.split("\n").filter((file) => path.basename(file).startsWith(".env"));
  return validateFinalMirrorInvocation({
    context,
    contextFile: args.contextFile,
    contextHash: args.contextHash,
    cwd,
    scriptPath,
    headSha: head.stdout.trim(),
    status: status.stdout,
    envFiles,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.contextFile) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, authority: "DIAGNOSTIC_ONLY", state: "NOT_EXECUTED", reason: "authoritative U007 mirror context required" }, null, 2)}\n`);
    return;
  }
  const context = await authoritativeContext(args);
  for (const key of ["FINAL_CANDIDATE_SHA", "FINAL_ALIAS_LEASE_MAP", "TASK_RUN_ID", "TASK_OWNER_UNIT", "PORT", "API_PORT", "ACCEPTANCE_EVIDENCE_DIR", "RESOURCE_LEASE_FILE"]) {
    if (!process.env[key]) throw new FinalAcceptanceError(`${key} is required`);
  }
  if (
    process.env.FINAL_CANDIDATE_SHA !== context.candidateSha ||
    process.env.TASK_RUN_ID !== context.runId ||
    process.env.TASK_OWNER_UNIT !== "U076"
  ) {
    throw new FinalAcceptanceError("authoritative environment identity differs from mirror context");
  }
  const webPort = Number(process.env.PORT);
  const apiPort = Number(process.env.API_PORT);
  if (![webPort, apiPort].every((port) => Number.isInteger(port) && port > 0 && port < 65536) || webPort === apiPort) {
    throw new FinalAcceptanceError("authoritative ports invalid");
  }
  const attemptDir = path.dirname(args.contextFile);
  const manifestFile = path.join(context.mirrorPath, "docs/12_VERIFICATION/acceptance-manifest.json");
  const aliasesFile = path.join(context.mirrorPath, "docs/12_VERIFICATION/test-alias-map.json");
  const manifestRows = JSON.parse(await readFile(manifestFile, "utf8"));
  const aliasEntries = JSON.parse(await readFile(aliasesFile, "utf8"));
  const aliasMapFile = path.resolve(process.env.FINAL_ALIAS_LEASE_MAP);
  const aliasMapBytes = await readFile(aliasMapFile);
  const aliasMapHash = hash(aliasMapBytes);
  const leaseMap = validateFinalAliasLeaseMap(JSON.parse(aliasMapBytes.toString("utf8")), aliasEntries);
  await validateLeasePathBoundaries(leaseMap);

  const registry = await spawnCommand(
    ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "node", "scripts/check-requirement-registry.mjs"],
    { cwd: context.mirrorPath, env: makeSanitizedProcessEnv({ lane: "generic" }), stream: true },
  );
  if (registry.code !== 0) throw new FinalAcceptanceError(`requirement registry preflight failed: ${registry.stderr.slice(-3000)}`);

  const imageLock = JSON.parse(await readFile(path.join(context.mirrorPath, "scripts/fixtures/restore-drill/postgres16-image.lock.json"), "utf8"));
  const result = await runFinalAcceptanceCore({
    candidateSha: context.candidateSha,
    runId: context.runId,
    manifestRows,
    aliasEntries,
    runStaging: () => runStagingEquivalent({
      mirrorRoot: context.mirrorPath,
      candidateSha: context.candidateSha,
      runId: context.runId,
      attemptDir,
      webPort,
      apiPort,
      resourceLeaseFile: path.resolve(process.env.RESOURCE_LEASE_FILE),
    }),
    writeManualPending: async () => {
      const receipt = {
        schemaVersion: 1,
        manifestId: "AC-DOD-09",
        candidateSha: context.candidateSha,
        runId: context.runId,
        ownerUnit: "U076",
        verificationState: "MANUAL_EXTERNAL_PENDING",
        approvalRequired: true,
        executed: false,
        result: "PENDING",
        reason: "External staging approval and execution are owner-controlled and were not performed by U076.",
        issuedAt: new Date().toISOString(),
      };
      await writeJson(path.join(attemptDir, "manual-external-staging.json"), receipt);
      return receipt;
    },
    runAlias: (entry) => runFinalAlias({
      mirrorRoot: context.mirrorPath,
      candidateSha: context.candidateSha,
      contextFile: args.contextFile,
      contextHash: args.contextHash,
      aliasMapFile,
      entry,
      lease: leaseMap[entry.alias],
      imageDigest: imageLock.manifestListDigest,
    }),
  });
  if (hash(await readFile(aliasMapFile)) !== aliasMapHash) {
    throw new FinalAcceptanceError("final alias lease map changed during execution");
  }
  await writeJson(path.join(attemptDir, "alias-partition.json"), {
    candidateSha: context.candidateSha,
    aliases: aliasEntries.map(({ alias, manifestRowIds }) => ({ alias, manifestRowIds })),
  });
  await writeJson(path.join(attemptDir, "acceptance-summary.json"), result);
  const summary = {
    schemaVersion: 1,
    authority: "AUTHORITATIVE_MIRROR_INTERNAL",
    ...result,
    contextHash: args.contextHash,
    aliasMapHash,
    createdAt: new Date().toISOString(),
  };
  await writeJson(path.join(attemptDir, "mirror-internal-summary.json"), summary);
  process.stdout.write(`U076_INNER_SUMMARY=${JSON.stringify(summary)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof FinalAcceptanceError ? 64 : 70;
  });
}
