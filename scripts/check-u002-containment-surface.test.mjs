import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  IMPLEMENTED_ENTRYPOINT_SCAN_PATHS,
  acceptIpcObservation,
  buildOwnedSourceManifest,
  captureRunnerTmpdirOwnership,
  createIpcObservation,
  createObservedCounterJournal,
  createMcpProbeDefinitions,
  createServiceDefinitions,
  createWorkflowPreflightMatrix,
  cleanupOne,
  cleanupServices,
  createCleanupFailure,
  createCleanupController,
  createRunnerInterruptHandler,
  evaluateImplementedEntrypointSurface,
  finalizeIpcObservation,
  finalizeObservedCounters,
  finalizeCleanup,
  finalizeU002Receipt,
  FINALIZATION_ARTIFACT_PATHS,
  OWNED_PATHS,
  markObservedChannel,
  recordObservedEvent,
  runRealSurface,
  settleRunnerCleanup,
  spawnService,
  assertRunnerOutputPathsFresh,
  assertRunnerFinalizationInputsFresh,
  parseVitestCount,
  validateFocusedArtifact,
  validateRunnerRunContext,
  validateSurfaceQaLinks,
  validateWebEnvReadAudit,
  writeFreshJson,
  writeWebEnvReadGuard,
  writePhaseOneFinalizationManifest,
} from "./check-u002-containment-surface.mjs";
import * as runnerModule from "./check-u002-containment-surface.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mutableChildProcess = createRequire(import.meta.url)("node:child_process");
const mutableFs = createRequire(import.meta.url)("node:fs");

async function withEntrypointFixture(run) {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-entrypoint-fixture-"));
  try {
    for (const path of IMPLEMENTED_ENTRYPOINT_SCAN_PATHS) {
      const destination = resolve(fixtureRoot, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(resolve(repoRoot, path), destination);
    }
    return await run(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    assert.equal(existsSync(fixtureRoot), false);
  }
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new TypeError("Expected TCP address");
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return address.port;
}

async function reserveServicePorts() {
  const names = ["web", "api", "workflow-operator", "engineer-bridge", "engineer-operator"];
  const reserved = new Set();
  while (reserved.size < names.length) reserved.add(await reservePort());
  return Object.fromEntries(names.map((name, index) => [name, [...reserved][index]]));
}

function createSpawnFixture(port) {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-spawn-fixture-"));
  const logsDir = resolve(fixtureRoot, "logs");
  const childDirectory = resolve(fixtureRoot, "child");
  mkdirSync(logsDir);
  mkdirSync(childDirectory);
  return {
    fixtureRoot,
    service: {
      name: "failure-injection",
      node: process.execPath,
      argv: [
        "-e",
        `const net=require('node:net');net.createServer().listen(${port},'127.0.0.1');setInterval(()=>{},1000)`,
      ],
      cwd: childDirectory,
      env: { ...process.env },
      port,
    },
    ownership: {
      logsDir,
      processRecordsPath: resolve(fixtureRoot, "processes.json"),
      publicRecords: [],
      ownedRecords: [],
    },
  };
}

test("reports the exact U002 containment baseline when the dispatcher snapshot matches", () => {
  // Given: the dedicated worktree is at the dispatcher's starting SHA and only scanner files transitioned.
  // When: the containment scanner inspects ownership, entrypoints, and lexical pure LOC.
  const result = spawnSync(process.execPath, [resolve(repoRoot, "scripts/check-u002-containment-surface.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });

  // Then: the baseline is an exact PASS, not a partial or inferred success.
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, "PASS");
  assert.equal(["BOOTSTRAP", "IMPLEMENTED"].includes(report.phase), true);
  assert.deepEqual(report.counts, {
    READ_ONLY: 8,
    MODIFY: 57,
    CREATE: 31,
    total: 96,
    uniqueTotal: 96,
  });
  assert.deepEqual(report.largeFileBaseline, {
    "services/sangfor-mcp-workflow/apps/operator-console/src/server.ts": 1169,
    "services/sangfor-mcp-workflow/apps/mcp-server/src/index.ts": 876,
    "services/sangfor-engineer-mcp/packages/sangfor-product-adapters/src/index.ts": 1004,
  });
  if (report.phase === "BOOTSTRAP") {
    assert.equal(report.entrypointHits.every((hit) => hit.matched), true);
    assert.deepEqual(report.measuredLargeFiles, report.largeFileBaseline);
  } else {
    assert.deepEqual(report.filesOver800, []);
    assert.equal(report.operatorServerPureLoc <= 250, true);
    assert.equal(report.workflowMcpIndexPureLoc <= 200, true);
    assert.equal(report.productAdapterIndexPureLoc <= 80, true);
    assert.deepEqual(report.sizeExceptions, []);
  }
  assert.deepEqual(report.errors, []);
});

test("implemented scanner compares the sorted current-tree entrypoint set exactly", () => {
  const report = evaluateImplementedEntrypointSurface(repoRoot);

  assert.equal(report.exact, true);
  assert.equal(report.verdict, "PASS");
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.actual, [...report.actual].sort((left, right) => left.key.localeCompare(right.key, "en")));
  assert.deepEqual(report.added, []);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.unreadable, []);
});

test("implemented scanner rejects a new indirect executor hit", async () => {
  await withEntrypointFixture(async (fixtureRoot) => {
    const injectedPath = "packages/agent/src/adapters.ts";
    const absolutePath = resolve(fixtureRoot, injectedPath);
    writeFileSync(
      absolutePath,
      `${readFileSync(absolutePath, "utf8")}\nconst injectedExecutor = executeLiveConsoleAction;\n`,
      "utf8",
    );

    const report = evaluateImplementedEntrypointSurface(fixtureRoot);

    assert.equal(report.exact, false);
    assert.equal(report.verdict, "PLAN_DRIFT_U002_SURFACE");
    assert.equal(report.exitCode, 65);
    assert.deepEqual(report.added, [{
      category: "live-execute",
      key: `live-console-executor:${injectedPath}`,
      path: injectedPath,
      rule: "live-console-executor",
    }]);
  });
});

test("Gate35 implemented scanner ignores comment and ordinary-string marker text", async () => {
  await withEntrypointFixture(async (fixtureRoot) => {
    const fixturePath = "packages/agent/src/adapters.ts";
    const absolutePath = resolve(fixtureRoot, fixturePath);
    writeFileSync(
      absolutePath,
      `${readFileSync(absolutePath, "utf8")}\n// executeLiveConsoleAction\nconst markerText = "executeLiveConsoleAction";\n`,
      "utf8",
    );

    const report = evaluateImplementedEntrypointSurface(fixtureRoot);

    assert.equal(report.exact, true);
    assert.deepEqual(report.added, []);
    assert.deepEqual(report.removed, []);
  });
});

test("implemented scanner rejects removed and unmatched expected hits", async () => {
  await withEntrypointFixture(async (fixtureRoot) => {
    const expectedPath = "services/sangfor-engineer-mcp/apps/mcp-server/src/index.ts";
    const absolutePath = resolve(fixtureRoot, expectedPath);
    const source = readFileSync(absolutePath, "utf8");
    writeFileSync(absolutePath, source.replaceAll("executeLiveConsoleAction", "removedExecutor"), "utf8");

    const unmatched = evaluateImplementedEntrypointSurface(fixtureRoot);
    assert.equal(unmatched.exact, false);
    assert.equal(unmatched.verdict, "PLAN_DRIFT_U002_SURFACE");
    assert.equal(unmatched.exitCode, 65);
    assert.equal(
      unmatched.removed.some((hit) => hit.rule === "live-console-executor" && hit.path === expectedPath),
      true,
    );

    rmSync(absolutePath);
    const removed = evaluateImplementedEntrypointSurface(fixtureRoot);
    assert.equal(removed.exact, false);
    assert.equal(removed.verdict, "PLAN_DRIFT_U002_SURFACE");
    assert.equal(removed.exitCode, 65);
    assert.deepEqual(removed.unreadable, [expectedPath]);
  });
});

test("corrected API auth baseline rejects removal of its executable auth-control surface", async () => {
  await withEntrypointFixture(async (fixtureRoot) => {
    const expectedPath = "apps/api/src/middleware/auth.ts";
    const absolutePath = resolve(fixtureRoot, expectedPath);
    const source = readFileSync(absolutePath, "utf8");
    writeFileSync(
      absolutePath,
      source
        .replaceAll("AUTH_BYPASS_ENABLED", "removedAuthBypassControl")
        .replaceAll("AUTH_PROFILE", "removedAuthProfileControl"),
      "utf8",
    );

    // When: the exact implemented surface is evaluated.
    const report = evaluateImplementedEntrypointSurface(fixtureRoot);

    // Then: the corrected auth-control path is reported as removed.
    assert.equal(report.exact, false);
    assert.equal(report.exitCode, 65);
    assert.equal(report.removed.some((hit) => hit.key === `auth-bypass-control:${expectedPath}`), true);
  });
});

test("corrected workflow policy baseline rejects removal of its executable auth-control surface", async () => {
  await withEntrypointFixture(async (fixtureRoot) => {
    const expectedPath = "services/sangfor-mcp-workflow/packages/shared/src/mutation-policy.ts";
    const absolutePath = resolve(fixtureRoot, expectedPath);
    const source = readFileSync(absolutePath, "utf8");
    writeFileSync(
      absolutePath,
      source
        .replaceAll("AUTH_BYPASS_ENABLED", "removedAuthBypassControl")
        .replaceAll("API_KEY_BYPASS_ENABLED", "removedApiKeyBypassControl")
        .replaceAll("WHELP99_ENFORCE_SAFE_TOOLS", "removedSafeToolControl"),
      "utf8",
    );

    const report = evaluateImplementedEntrypointSurface(fixtureRoot);

    assert.equal(report.exact, false);
    assert.equal(report.exitCode, 65);
    assert.equal(report.removed.some((hit) => hit.key === `auth-bypass-control:${expectedPath}`), true);
  });
});

test("corrected Web route baseline rejects reintroduced caller actor injection", async () => {
  await withEntrypointFixture(async (fixtureRoot) => {
    // Given: caller actor identity is reintroduced directly into the Web MCP route.
    const injectedPath = "apps/web/src/app/api/mcp/tools/route.ts";
    const absolutePath = resolve(fixtureRoot, injectedPath);
    writeFileSync(
      absolutePath,
      `${readFileSync(absolutePath, "utf8")}\nconst actorId = "caller-controlled";\n`,
      "utf8",
    );

    // When: the exact implemented surface is evaluated.
    const report = evaluateImplementedEntrypointSurface(fixtureRoot);

    // Then: the lexical regression is a new caller-identity entrypoint and code 65.
    assert.equal(report.exact, false);
    assert.equal(report.exitCode, 65);
    assert.deepEqual(report.added, [{
      category: "caller-identity",
      key: `caller-identity-field:${injectedPath}`,
      path: injectedPath,
      rule: "caller-identity-field",
    }]);
  });
});

test("spawn ownership survives process-record evidence failure and cleans the detached group", async () => {
  const port = await reservePort();
  const fixture = createSpawnFixture(port);
  try {
    await assert.rejects(
      spawnService(fixture.service, {
        ...fixture.ownership,
        hooks: { writeJson: () => { throw new Error("INJECTED_EVIDENCE_WRITE_FAILURE"); } },
      }),
      /INJECTED_EVIDENCE_WRITE_FAILURE/u,
    );
    assert.equal(fixture.ownership.ownedRecords.length, 1);
    const cleanup = await cleanupOne(fixture.ownership.ownedRecords[0]);
    assert.deepEqual(
      { processCount: cleanup.processCount, portOwnerCount: cleanup.portOwnerCount, rebind: cleanup.rebind },
      { processCount: 0, portOwnerCount: 0, rebind: "PASS" },
    );
  } finally {
    rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    assert.equal(existsSync(fixture.fixtureRoot), false);
  }
});

test("spawn ownership survives PID/PGID mismatch and cleans the detached group", async () => {
  const port = await reservePort();
  const fixture = createSpawnFixture(port);
  try {
    await assert.rejects(
      spawnService(fixture.service, {
        ...fixture.ownership,
        hooks: { pidProcessGroup: (pid) => pid + 1 },
      }),
      /PID_PGID_MISMATCH/u,
    );
    assert.equal(fixture.ownership.ownedRecords.length, 1);
    const cleanup = await cleanupOne(fixture.ownership.ownedRecords[0]);
    assert.equal(cleanup.processCount, 0);
    assert.equal(cleanup.portOwnerCount, 0);
    assert.equal(cleanup.rebind, "PASS");
  } finally {
    rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    assert.equal(existsSync(fixture.fixtureRoot), false);
  }
});

test("interrupt cleanup owns a detached child before later awaited work", async () => {
  const port = await reservePort();
  const fixture = createSpawnFixture(port);
  let releaseRegistration;
  let registrationObserved;
  const registered = new Promise((resolveRegistered) => { registrationObserved = resolveRegistered; });
  const blocked = new Promise((resolveBlocked) => { releaseRegistration = resolveBlocked; });
  try {
    const spawnPromise = spawnService(fixture.service, {
      ...fixture.ownership,
      hooks: {
        afterOwnershipRegistered: async () => {
          registrationObserved();
          await blocked;
        },
        pidProcessGroup: (pid) => pid,
      },
    });
    await registered;
    const controller = createCleanupController(async () => cleanupOne(fixture.ownership.ownedRecords[0]));

    const interrupted = await controller.interrupt("SIGINT");
    releaseRegistration();
    await spawnPromise;

    assert.equal(interrupted.exitCode, 130);
    assert.equal(interrupted.cleanup.processCount, 0);
    assert.equal(interrupted.cleanup.portOwnerCount, 0);
    assert.equal(interrupted.cleanup.rebind, "PASS");
  } finally {
    releaseRegistration?.();
    rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    assert.equal(existsSync(fixture.fixtureRoot), false);
  }
});

test("Gate38 zero-spawn cleanup records NOT_STARTED with five successful rebinds and preserves the primary code", async () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-gate38-zero-spawn-"));
  const runnerTmpdirPath = mkdtempSync(resolve(fixtureRoot, "runner-"));
  const runnerTmpdir = captureRunnerTmpdirOwnership({
    logicalPath: runnerTmpdirPath,
    realPath: realpathSync(runnerTmpdirPath),
    mode: "0700",
  });
  const cleanupPath = resolve(fixtureRoot, "cleanup.json");
  const ports = await reserveServicePorts();
  const primaryError = Object.assign(new Error("focused evidence was stale"), {
    code: "FOCUSED_ARTIFACT_NOT_FRESH",
    exitCode: 68,
  });
  try {
    const cleanup = await finalizeCleanup(
      [],
      cleanupPath,
      runnerTmpdir,
      undefined,
      ports,
      primaryError,
    );

    assert.equal(cleanup.result, "PASS");
    assert.equal(cleanup.totals.rebindPass, 5);
    assert.deepEqual(
      Object.values(cleanup.services).map((service) => ({ state: service.state, rebind: service.rebind })),
      Array.from({ length: 5 }, () => ({ state: "NOT_STARTED", rebind: "PASS" })),
    );
    assert.deepEqual(cleanup.primaryFailure, {
      name: "Error",
      message: "focused evidence was stale",
      code: "FOCUSED_ARTIFACT_NOT_FRESH",
      exitCode: 68,
    });
    assert.deepEqual(JSON.parse(readFileSync(cleanupPath, "utf8")), cleanup);
    assert.equal(existsSync(resolve(fixtureRoot, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixtureRoot, "receipt.json")), false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate38 partial-spawn cleanup stops the owned service and classifies the other four as NOT_STARTED", async () => {
  const ports = await reserveServicePorts();
  const fixture = createSpawnFixture(ports.web);
  fixture.service.name = "web";
  let cleaned = false;
  try {
    await spawnService(fixture.service, fixture.ownership);
    const cleanup = await cleanupServices(fixture.ownership.ownedRecords, ports);
    cleaned = true;

    assert.equal(cleanup.result, "PASS");
    assert.deepEqual(
      { state: cleanup.services.web.state, rebind: cleanup.services.web.rebind },
      { state: "STOPPED", rebind: "PASS" },
    );
    for (const name of ["api", "workflow-operator", "engineer-bridge", "engineer-operator"]) {
      assert.deepEqual(
        { state: cleanup.services[name].state, rebind: cleanup.services[name].rebind },
        { state: "NOT_STARTED", rebind: "PASS" },
      );
    }
    assert.deepEqual(cleanup.totals, {
      processes: 0,
      listeners: 0,
      portOwners: 0,
      rebindPass: 5,
    });
    assert.equal(existsSync(resolve(fixture.fixtureRoot, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.fixtureRoot, "receipt.json")), false);
  } finally {
    if (!cleaned && fixture.ownership.ownedRecords.length !== 0) {
      await cleanupOne(fixture.ownership.ownedRecords[0]).catch(() => {});
    }
    rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate38 cleanup failure takes precedence while retaining primary and cleanup causes", () => {
  const primaryError = Object.assign(new Error("focused evidence was stale"), {
    code: "FOCUSED_ARTIFACT_NOT_FRESH",
    exitCode: 68,
  });
  const cleanupError = Object.assign(new Error("cleanup rejected"), {
    code: "INJECTED_CLEANUP_REJECTION",
  });
  for (const [cleanup, rejection] of [
    [{ result: "FAIL", errors: ["rebind failed"] }, undefined],
    [undefined, cleanupError],
  ]) {
    const failure = createCleanupFailure(primaryError, cleanup, rejection);
    assert.equal(failure.code, "REAL_SURFACE_CLEANUP_FAILED");
    assert.equal(failure.exitCode, 68);
    assert.equal(failure.cause, primaryError);
    assert.match(failure.message, /FOCUSED_ARTIFACT_NOT_FRESH/u);
    if (rejection) assert.match(failure.message, /INJECTED_CLEANUP_REJECTION/u);
  }
});

test("Gate38 rejected interrupt cleanup tears down signal listeners, surfaces both causes, and remains exact-once", async () => {
  const signalTarget = new EventEmitter();
  const primaryError = Object.assign(new Error("focused evidence was stale"), {
    code: "FOCUSED_ARTIFACT_NOT_FRESH",
    exitCode: 68,
  });
  const rejection = Object.assign(new Error("cleanup rejected"), {
    code: "INJECTED_CLEANUP_REJECTION",
  });
  let cleanupCalls = 0;
  const exitCodes = [];
  const diagnostics = [];
  const controller = createCleanupController(async () => {
    cleanupCalls += 1;
    await Promise.resolve();
    throw rejection;
  });
  const onSigint = () => {};
  const onSigterm = () => {};
  signalTarget.once("SIGINT", onSigint);
  signalTarget.once("SIGTERM", onSigterm);
  const interrupt = createRunnerInterruptHandler({
    cleanupOnce: controller.cleanupOnce,
    getPrimaryError: () => primaryError,
    onSigint,
    onSigterm,
    signalTarget,
    exitProcess: (exitCode) => exitCodes.push(exitCode),
    writeDiagnostic: (message) => diagnostics.push(message),
  });

  const settled = await Promise.allSettled([
    interrupt("SIGINT"),
    controller.cleanupOnce(),
    interrupt("SIGTERM"),
  ]);

  assert.equal(cleanupCalls, 1);
  assert.equal(settled[0].status, "fulfilled");
  assert.equal(settled[0].value.cleanup, undefined);
  assert.equal(settled[0].value.cleanupError, rejection);
  assert.equal(settled[0].value.cleanupFailure.code, "REAL_SURFACE_CLEANUP_FAILED");
  assert.equal(settled[0].value.cleanupFailure.cause, primaryError);
  assert.equal(settled[1].status, "rejected");
  assert.equal(settled[2].status, "fulfilled");
  assert.equal(settled[2].value, settled[0].value);
  assert.deepEqual(exitCodes, [68]);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /REAL_SURFACE_CLEANUP_FAILED/u);
  assert.match(diagnostics[0], /FOCUSED_ARTIFACT_NOT_FRESH/u);
  assert.match(diagnostics[0], /INJECTED_CLEANUP_REJECTION/u);
  assert.equal(signalTarget.listenerCount("SIGINT"), 0);
  assert.equal(signalTarget.listenerCount("SIGTERM"), 0);
});

test("Gate35 builds the exact sixteen-row trimmed workflow preflight matrix", () => {
  // Given: both workflow entrypoints have otherwise-valid production configuration.
  const matrix = createWorkflowPreflightMatrix({
    node22Bin: "/runtime/node22",
    workflowRoot: "/repo/workflow",
    runtimeDir: "/attempt/runtime",
    commonEnv: {
      NODE_ENV: "production",
      SANGFOR_API_KEY: "workflow-service-key-000000000000",
      MCP_API_KEY: "workflow-mcp-key-000000000000000",
      SANGFOR_OPERATOR_PRINCIPAL_ID: "u002-local-operator",
      WHELP99_ENFORCE_SAFE_TOOLS: "true",
    },
    workflowOperatorPort: 45101,
  });

  // When: matrix rows are grouped by entrypoint, field, and missing/blank variant.
  const keys = matrix.map((row) => `${row.entrypoint}:${row.field}:${row.variant}`);

  // Then: all 2 x 4 x 2 combinations exist once and no aggregate missing-env row remains.
  assert.equal(matrix.length, 16);
  assert.equal(new Set(keys).size, 16);
  assert.deepEqual(
    new Set(matrix.map((row) => row.entrypoint)),
    new Set(["workflow-operator", "workflow-mcp"]),
  );
  assert.deepEqual(
    new Set(matrix.map((row) => row.field)),
    new Set([
      "MCP_API_KEY",
      "SANGFOR_API_KEY",
      "SANGFOR_OPERATOR_PRINCIPAL_ID",
      "WHELP99_ENFORCE_SAFE_TOOLS",
    ]),
  );
  assert.deepEqual(new Set(matrix.map((row) => row.variant)), new Set(["missing", "blank"]));
  assert.equal(matrix.every((row) => row.expectedExitCode === 78), true);
});

test("Gate35 Web preload blocks dotenv reads before delegation and records both phases", () => {
  // Given: an attempt-local guard protects a fixture repository and HOME.
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-web-env-guard-"));
  let auditJournal;
  try {
    const repository = resolve(fixtureRoot, "repo");
    const home = resolve(fixtureRoot, "home");
    const runtime = resolve(fixtureRoot, "runtime/web");
    const auditPath = resolve(fixtureRoot, "real-surface/web-env-read-audit.json");
    const guardPath = resolve(runtime, "env-read-guard.cjs");
    mkdirSync(repository, { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    mkdirSync(dirname(auditPath), { recursive: true });
    writeFileSync(resolve(repository, ".env.local"), "FORBIDDEN=repo-secret\n", "utf8");
    writeFileSync(resolve(home, ".env"), "FORBIDDEN=home-secret\n", "utf8");
    writeFileSync(resolve(repository, "safe.txt"), "safe\n", "utf8");
    ({ auditJournal } = writeWebEnvReadGuard({ guardPath, auditPath, repository, home }));

    // When: independent build/start processes preload the guard and attempt dotenv reads.
    for (const phase of ["build", "start"]) {
      const result = spawnSync(process.execPath, [
        "-e",
        `const fs=require('node:fs');for(const path of ${JSON.stringify([resolve(repository, ".env.local"), resolve(home, ".env")])}){try{fs.readFileSync(path,'utf8')}catch(error){if(error.code!=='U002_ENV_READ_BLOCKED')throw error}}process.stdout.write(fs.readFileSync(${JSON.stringify(resolve(repository, "safe.txt"))},'utf8'))`,
        phase,
      ], {
        cwd: runtime,
        encoding: "utf8",
        env: { NODE_OPTIONS: `--require=${guardPath}` },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "safe\n");
    }

    // Then: guard/audit are regular files and no dotenv read reached the delegated fs methods.
    const audit = validateWebEnvReadAudit(auditPath);
    assert.equal(lstatSync(guardPath).isSymbolicLink(), false);
    assert.equal(lstatSync(guardPath).isFile(), true);
    assert.equal(audit.delegatedReadCount, 0);
    assert.equal(audit.guardExecutions.build >= 1, true);
    assert.equal(audit.guardExecutions.start >= 1, true);
    assert.equal(audit.blockedAttempts.length, 4);
    assert.equal(JSON.stringify(audit).includes("repo-secret"), false);
    assert.equal(JSON.stringify(audit).includes("home-secret"), false);

    writeFileSync(auditPath, `${JSON.stringify({ ...audit, delegatedReadCount: 1 })}\n`, "utf8");
    assert.throws(() => validateWebEnvReadAudit(auditPath), /WEB_ENV_AUDIT_INVALID/u);
  } finally {
    auditJournal?.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate38 Web env audit rejects pathname replacement without overwriting it", () => {
  // Given: the guard created and updated one identity-bound audit inode.
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-web-env-audit-identity-"));
  let auditJournal;
  try {
    const repository = resolve(fixtureRoot, "repo");
    const home = resolve(fixtureRoot, "home");
    const runtime = resolve(fixtureRoot, "runtime/web");
    const auditPath = resolve(fixtureRoot, "real-surface/web-env-read-audit.json");
    const guardPath = resolve(runtime, "env-read-guard.cjs");
    mkdirSync(repository, { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    mkdirSync(dirname(auditPath), { recursive: true });
    ({ auditJournal } = writeWebEnvReadGuard({ guardPath, auditPath, repository, home }));
    const build = spawnSync(process.execPath, ["-e", "", "build"], {
      cwd: runtime,
      encoding: "utf8",
      env: { NODE_OPTIONS: `--require=${guardPath}` },
    });
    assert.equal(build.status, 0, build.stderr);
    const originalIdentity = lstatSync(auditPath, { bigint: true });
    unlinkSync(auditPath);
    const sentinel = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      guardExecutions: { build: 9, start: 9, unknown: 0 },
      blockedAttempts: [],
      delegatedReadCount: 0,
      owner: "replacement",
    })}\n`);
    writeFileSync(auditPath, sentinel, { flag: "wx", mode: 0o600 });

    // When: a later real preload execution reaches the replaced audit pathname.
    const start = spawnSync(process.execPath, ["-e", "", "start"], {
      cwd: runtime,
      encoding: "utf8",
      env: { NODE_OPTIONS: `--require=${guardPath}` },
    });

    // Then: the guard rejects the takeover and never truncates the other owner's bytes.
    assert.notEqual(start.status, 0);
    assert.match(start.stderr, /U002_ENV_AUDIT_IDENTITY_CHANGED/u);
    assert.deepEqual(readFileSync(auditPath), sentinel);
    const replacementIdentity = lstatSync(auditPath, { bigint: true });
    assert.equal(
      replacementIdentity.dev === originalIdentity.dev && replacementIdentity.ino === originalIdentity.ino,
      false,
    );
  } finally {
    auditJournal?.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate35 IPC observation accepts only the armed exact capture and completion", () => {
  // Given: the API boundary is armed with one nonce and exact stripped arguments.
  const observation = createIpcObservation({
    boundary: "api-to-infra",
    nonce: "nonce-api",
    deadlineAt: 500,
    expectedToolName: "sangfor.products",
    expectedArguments: { keep: "value", nested: { values: [{}, {}] } },
  });

  // When: the exact one-shot sequence is observed before the deadline.
  acceptIpcObservation(observation, {
    protocol: "u002-containment-ipc/v1",
    type: "armed",
    boundary: "api-to-infra",
    nonce: "nonce-api",
  }, 100);
  const capture = acceptIpcObservation(observation, {
    protocol: "u002-containment-ipc/v1",
    type: "capture",
    boundary: "api-to-infra",
    nonce: "nonce-api",
    toolName: "sangfor.products",
    arguments: { keep: "value", nested: { values: [{}, {}] } },
  }, 200);
  observation.release();
  acceptIpcObservation(observation, {
    protocol: "u002-containment-ipc/v1",
    type: "complete",
    boundary: "api-to-infra",
    nonce: "nonce-api",
    outcome: "returned",
  }, 300);

  // Then: the barrier releases exactly one capture and finalization is complete.
  assert.equal(capture.kind, "capture");
  assert.deepEqual(finalizeIpcObservation(observation), {
    toolName: "sangfor.products",
    arguments: { keep: "value", nested: { values: [{}, {}] } },
  });
});

test("Gate35 IPC observation rejects missing forged delayed and duplicate evidence", () => {
  const fixture = () => createIpcObservation({
    boundary: "bridge-to-child",
    nonce: "nonce-bridge",
    deadlineAt: 500,
    expectedToolName: "sangfor.products",
    expectedArguments: {
      keep: "value",
      nested: { values: [{}, {}] },
      actorId: "u002-local-operator",
    },
  });

  // Given: four independently armed observations.
  const missing = fixture();
  const forged = fixture();
  const delayed = fixture();
  const duplicate = fixture();
  for (const observation of [missing, forged, delayed, duplicate]) {
    acceptIpcObservation(observation, {
      protocol: "u002-containment-ipc/v1",
      type: "armed",
      boundary: "bridge-to-child",
      nonce: "nonce-bridge",
    }, 100);
  }

  // When: evidence is absent, nonce-forged, late, or duplicated.
  acceptIpcObservation(forged, {
    protocol: "u002-containment-ipc/v1",
    type: "capture",
    boundary: "bridge-to-child",
    nonce: "forged",
    toolName: "sangfor.products",
    arguments: {},
  }, 200);
  assert.throws(() => acceptIpcObservation(delayed, {
    protocol: "u002-containment-ipc/v1",
    type: "capture",
    boundary: "bridge-to-child",
    nonce: "nonce-bridge",
    toolName: "sangfor.products",
    arguments: { keep: "value", nested: { values: [{}, {}] }, actorId: "u002-local-operator" },
  }, 501), /IPC_CAPTURE_DEADLINE_EXCEEDED/u);
  const exactCapture = {
    protocol: "u002-containment-ipc/v1",
    type: "capture",
    boundary: "bridge-to-child",
    nonce: "nonce-bridge",
    toolName: "sangfor.products",
    arguments: { keep: "value", nested: { values: [{}, {}] }, actorId: "u002-local-operator" },
  };
  acceptIpcObservation(duplicate, exactCapture, 200);
  assert.throws(() => acceptIpcObservation(duplicate, exactCapture, 201), /IPC_CAPTURE_DUPLICATE/u);

  // Then: none can be promoted to complete evidence.
  assert.throws(() => finalizeIpcObservation(missing), /IPC_EVIDENCE_INCOMPLETE/u);
  assert.throws(() => finalizeIpcObservation(forged), /IPC_EVIDENCE_INCOMPLETE/u);
  assert.throws(() => finalizeIpcObservation(delayed), /IPC_EVIDENCE_INCOMPLETE/u);
  assert.throws(() => finalizeIpcObservation(duplicate), /IPC_EVIDENCE_INCOMPLETE/u);
});

test("Gate35 observed counters require event-backed positives and live zero-count channels", () => {
  // Given: positive boundary counts have unique observed events and zero-count spies were armed.
  const journal = createObservedCounterJournal("run-gate35");
  for (const [counter, event] of [
    ["toolEnumeration", "request:api-tools-list"],
    ["handlerCall", "request:api-tools-call"],
    ["infra", "ipc:api-to-infra:capture"],
    ["bridge", "ipc:bridge-to-child:capture"],
    ["child", "ipc:bridge-to-child:complete"],
  ]) recordObservedEvent(journal, counter, event);
  markObservedChannel(journal, "external", "loopback-http-spy", 3);
  markObservedChannel(journal, "restore", "process-executable-spy", 8);

  // When: counters are finalized from the event journal.
  const counters = finalizeObservedCounters(journal);

  // Then: values are event lengths and zeroes remain accepted only with observed probe channels.
  assert.equal(counters.counters.toolEnumeration.count, 1);
  assert.equal(counters.counters.child.count, 1);
  assert.equal(counters.counters.external.count, 0);
  assert.equal(counters.counters.restore.count, 0);
  const missingSource = createObservedCounterJournal("run-gate35-missing");
  assert.throws(() => finalizeObservedCounters(missingSource), /OBSERVED_COUNTER_EVIDENCE_MISSING/u);
});

test("Gate35 focused artifact validation rejects stale symlink empty and wrong-hash logs", () => {
  // Given: one current-run regular log and adversarial variants.
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-focused-artifact-"));
  try {
    const logPath = resolve(fixtureRoot, "focused.log");
    writeFileSync(logPath, "Tests 3 passed\n", "utf8");
    const mtime = statSync(logPath).mtimeMs;
    const valid = validateFocusedArtifact({ path: logPath, startedAt: mtime - 1, endedAt: mtime + 1 });
    assert.equal(valid.testCount, 3);
    assert.match(valid.sha256, /^[a-f0-9]{64}$/u);

    const empty = resolve(fixtureRoot, "empty.log");
    writeFileSync(empty, "", "utf8");
    const symbolic = resolve(fixtureRoot, "symbolic.log");
    symlinkSync(logPath, symbolic);
    assert.throws(() => validateFocusedArtifact({ path: empty, startedAt: 0, endedAt: Date.now() }), /FOCUSED_ARTIFACT_EMPTY/u);
    assert.throws(() => validateFocusedArtifact({ path: symbolic, startedAt: 0, endedAt: Date.now() }), /FOCUSED_ARTIFACT_NOT_REGULAR/u);
    assert.throws(() => validateFocusedArtifact({ path: logPath, startedAt: mtime + 10, endedAt: mtime + 20 }), /FOCUSED_ARTIFACT_STALE/u);
    assert.throws(() => validateFocusedArtifact({ path: logPath, startedAt: 0, endedAt: mtime + 1, expectedSha256: "0".repeat(64) }), /FOCUSED_ARTIFACT_HASH_MISMATCH/u);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate40 focused artifact accepts a fractional mtime inside the terminal window millisecond", () => {
  // Given: a regular log whose mtime carries a sub-millisecond fraction inside
  // the same millisecond that Date.now() recorded as the window end.
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-gate40-boundary-"));
  try {
    const logPath = resolve(fixtureRoot, "focused.log");
    writeFileSync(logPath, "Tests 3 passed\n", "utf8");
    const base = Math.floor(statSync(logPath).mtimeMs);
    utimesSync(logPath, (base + 0.5) / 1000, (base + 0.5) / 1000);
    const forced = statSync(logPath).mtimeMs;
    assert.ok(forced > Math.floor(forced), "filesystem must retain a sub-millisecond fraction");
    const endedAt = Math.floor(forced);
    const startedAt = endedAt - 60_000;
    // Then: the truncation-equivalent terminal millisecond is accepted.
    const accepted = validateFocusedArtifact({ path: logPath, startedAt, endedAt });
    assert.equal(accepted.testCount, 3);
    // And: one whole millisecond past the recorded end is still stale.
    assert.throws(
      () => validateFocusedArtifact({ path: logPath, startedAt, endedAt: endedAt - 1 }),
      /FOCUSED_ARTIFACT_STALE/u,
    );
    // And: the exact untruncated lower bound is unchanged.
    assert.throws(
      () => validateFocusedArtifact({ path: logPath, startedAt: forced + 1, endedAt: endedAt + 10 }),
      /FOCUSED_ARTIFACT_STALE/u,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate41 parseVitestCount accepts ANSI SGR-colored vitest4 summary shape", () => {
  // Given: the real attempt-8 engineer summary shape (Tests + SGR + 45 passed).
  // Before Gate41 this returned 0 and raised FOCUSED_ARTIFACT_ZERO_TESTS.
  const ansiSummary = [
    "\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m45 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m2 skipped\u001b[39m\u001b[90m (47)\u001b[39m\n",
    "exitCode=0\n",
  ].join("");
  assert.equal(parseVitestCount(ansiSummary), 45);

  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-gate41-ansi-"));
  try {
    const logPath = resolve(fixtureRoot, "engineer-focused.log");
    writeFileSync(logPath, ansiSummary, "utf8");
    const mtime = statSync(logPath).mtimeMs;
    const accepted = validateFocusedArtifact({
      path: logPath,
      startedAt: mtime - 1,
      endedAt: Math.floor(mtime) + 1,
    });
    assert.equal(accepted.testCount, 45);

    // Adversarial: ANSI-colored log with no matching summary still zero-tests.
    const noSummary = resolve(fixtureRoot, "no-summary.log");
    writeFileSync(noSummary, "\u001b[32mAll green\u001b[39m but no Tests line\n", "utf8");
    const noSummaryMtime = statSync(noSummary).mtimeMs;
    assert.throws(
      () => validateFocusedArtifact({
        path: noSummary,
        startedAt: noSummaryMtime - 1,
        endedAt: Math.floor(noSummaryMtime) + 1,
      }),
      /FOCUSED_ARTIFACT_ZERO_TESTS/u,
    );

    // Adversarial: colorless genuine zero-test log still rejected.
    const zero = resolve(fixtureRoot, "zero.log");
    writeFileSync(zero, "Tests 0 passed\n", "utf8");
    const zeroMtime = statSync(zero).mtimeMs;
    assert.throws(
      () => validateFocusedArtifact({
        path: zero,
        startedAt: zeroMtime - 1,
        endedAt: Math.floor(zeroMtime) + 1,
      }),
      /FOCUSED_ARTIFACT_ZERO_TESTS/u,
    );

    // Adversarial: ANSI stripping must not invent a count when the summary is absent.
    assert.equal(parseVitestCount("\u001b[1m\u001b[32mpassed\u001b[39m\n"), 0);
    assert.equal(parseVitestCount(""), 0);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate42 MCP probe definitions satisfy fail-closed boot preflights", () => {
  const defs = createMcpProbeDefinitions(
    { node20Bin: "/fake/node20", node22Bin: "/fake/node22" },
    {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/u002-gate42-home",
      TMPDIR: "/tmp",
      LANG: "C",
      LC_ALL: "C",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      AUTH_BYPASS_ENABLED: "0",
      SANGFOR_OPERATOR_PRINCIPAL_ID: "u002-local-operator",
      NO_PROXY: "127.0.0.1,localhost",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
    },
    "/tmp/u002-gate42-runtime",
  );

  assert.equal(defs.length, 2);
  assert.equal(defs[0].name, "workflow-mcp-probe");
  assert.equal(defs[0].node, "/fake/node22");
  assert.equal(defs[1].name, "engineer-mcp-probe");
  assert.equal(defs[1].node, "/fake/node20");

  const workflowEnv = defs[0].env;
  const engineerEnv = defs[1].env;

  for (const key of ["MCP_API_KEY", "SANGFOR_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID"]) {
    assert.equal(typeof workflowEnv[key], "string");
    assert.ok(workflowEnv[key].length > 0, `workflow env ${key} must be non-blank`);
  }
  assert.equal(workflowEnv.WHELP99_ENFORCE_SAFE_TOOLS, "true");

  for (const key of ["SANGFOR_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID"]) {
    assert.equal(typeof engineerEnv[key], "string");
    assert.ok(engineerEnv[key].length > 0, `engineer env ${key} must be non-blank`);
  }
  assert.equal(engineerEnv.WHELP99_ENFORCE_SAFE_TOOLS, "true");

  for (const [label, env] of [["workflow", workflowEnv], ["engineer", engineerEnv]]) {
    assert.equal(env.AUTH_BYPASS_ENABLED, "0");
    for (const [key, value] of Object.entries(env)) {
      if (key === "AUTH_BYPASS_ENABLED") continue;
      if (!/bypass/i.test(key)) continue;
      assert.ok(
        !["1", "true", "yes", "on"].includes(String(value).toLowerCase()),
        `${label} env ${key} must not be enabled`,
      );
    }
    assert.equal(env.DATABASE_URL, undefined);
    assert.notEqual(env.MCP_API_KEY, "invalid-credential");
    assert.notEqual(env.SANGFOR_API_KEY, "invalid-credential");
  }

  assert.ok(String(defs[0].argv[1]).endsWith("apps/mcp-server/src/index.ts"));
  assert.ok(String(defs[1].argv[1]).endsWith("apps/mcp-server/src/index.ts"));
  assert.ok(String(defs[0].cwd).endsWith("workflow-mcp-probe"));
  assert.ok(String(defs[1].cwd).endsWith("engineer-mcp-probe"));

  // Service-definition env must also satisfy product fail-closed boot preflights
  // (workflow-operator gap closed in Gate42 r2).
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-gate42-service-env-"));
  try {
    const evidenceDir = resolve(fixtureRoot, "real-surface");
    mkdirSync(resolve(evidenceDir, "runtime"), { recursive: true });
    const ports = {
      web: 45110,
      api: 45111,
      "workflow-operator": 45112,
      "engineer-operator": 45113,
      "engineer-bridge": 45114,
    };
    const services = createServiceDefinitions(
      {
        evidenceDir,
        node20Bin: "/runtime/node20",
        node22Bin: "/runtime/node22",
        ports,
      },
      {
        HOME: "/attempt/home",
        NODE_ENV: "production",
        AUTH_BYPASS_ENABLED: "0",
        SANGFOR_OPERATOR_PRINCIPAL_ID: "u002-local-operator",
      },
      "runner-api-key",
      "--require=/attempt/env-read-guard.cjs",
    );

    const byName = Object.fromEntries(services.map((s) => [s.name, s]));
    const workflowOp = byName["workflow-operator"];
    assert.ok(workflowOp);
    for (const key of ["SANGFOR_API_KEY", "MCP_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID"]) {
      assert.equal(typeof workflowOp.env[key], "string");
      assert.ok(workflowOp.env[key].length > 0, `workflow-operator env ${key} must be non-blank`);
    }
    assert.equal(workflowOp.env.WHELP99_ENFORCE_SAFE_TOOLS, "true");

    for (const name of ["engineer-bridge", "engineer-operator"]) {
      const svc = byName[name];
      assert.ok(svc, `${name} service definition must exist`);
      assert.equal(svc.env.WHELP99_ENFORCE_SAFE_TOOLS, "true");
      assert.equal(typeof svc.env.SANGFOR_API_KEY, "string");
      assert.ok(svc.env.SANGFOR_API_KEY.length > 0, `${name} SANGFOR_API_KEY must be non-blank`);
    }

    for (const svc of services) {
      assert.equal(svc.env.AUTH_BYPASS_ENABLED, "0", `${svc.name} AUTH_BYPASS_ENABLED must be "0"`);
      for (const [key, value] of Object.entries(svc.env)) {
        if (key === "AUTH_BYPASS_ENABLED") continue;
        if (!/bypass/i.test(key)) continue;
        assert.ok(
          !["1", "true", "yes", "on"].includes(String(value).toLowerCase()),
          `${svc.name} env ${key} must not be enabled`,
        );
      }
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate35 Web launch contract preserves the app argv cwd and isolates NODE_OPTIONS", () => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-service-definitions-"));
  try {
    const evidenceDir = resolve(fixtureRoot, "real-surface");
    mkdirSync(resolve(evidenceDir, "runtime"), { recursive: true });
    const ports = {
      web: 45110,
      api: 45111,
      "workflow-operator": 45112,
      "engineer-operator": 45113,
      "engineer-bridge": 45114,
    };
    const definitions = createServiceDefinitions({
      evidenceDir,
      node20Bin: "/runtime/node20",
      node22Bin: "/runtime/node22",
      ports,
    }, {
      HOME: "/attempt/home",
      NODE_ENV: "production",
    }, "runner-api-key", "--require=/attempt/env-read-guard.cjs");

    const web = definitions.find((definition) => definition.name === "web");
    assert.ok(web);
    assert.equal(web.node, "/runtime/node20");
    assert.deepEqual(web.argv, [
      resolve(repoRoot, "apps/web/node_modules/next/dist/bin/next"),
      "start",
      resolve(repoRoot, "apps/web"),
      "-H",
      "127.0.0.1",
      "-p",
      String(ports.web),
    ]);
    assert.equal(web.cwd, resolve(evidenceDir, "runtime/web"));
    assert.equal(web.env.NODE_OPTIONS, "--require=/attempt/env-read-guard.cjs");
    assert.equal(
      definitions.filter((definition) => definition.name !== "web")
        .every((definition) => !Object.hasOwn(definition.env, "NODE_OPTIONS")),
      true,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate35 source manifest uses bytewise path-NUL-hash-NUL-bytes-LF framing", () => {
  // Given: two regular source files whose lexical order differs by case.
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-source-manifest-"));
  try {
    writeFileSync(resolve(fixtureRoot, "A.ts"), "alpha\n", "utf8");
    writeFileSync(resolve(fixtureRoot, "a.ts"), "beta\n", "utf8");

    // When: the aggregate is built twice from unordered input.
    const first = buildOwnedSourceManifest(fixtureRoot, ["a.ts", "A.ts"]);
    const second = buildOwnedSourceManifest(fixtureRoot, ["A.ts", "a.ts"]);

    // Then: entries are bytewise-sorted and the exact binary framing is stable.
    assert.deepEqual(first.entries.map((entry) => entry.path), ["A.ts", "a.ts"]);
    assert.equal(first.aggregateSha256, second.aggregateSha256);
    assert.equal(first.count, 2);
    assert.equal(first.framingBytes, first.entries.reduce(
      (total, entry) => total + Buffer.byteLength(`${entry.path}\0${entry.sha256}\0${entry.bytes}\n`),
      0,
    ));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate36 artifact authority is the exact complete bytewise lifecycle set", () => {
  const sorted = (values) => [...values].sort((left, right) => (
    Buffer.compare(Buffer.from(left), Buffer.from(right))
  ));
  const services = ["web", "api", "workflow-operator", "engineer-bridge", "engineer-operator"];
  const fields = ["MCP_API_KEY", "SANGFOR_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID", "WHELP99_ENFORCE_SAFE_TOOLS"];
  const identityFields = ["approvedBy", "actorId", "requestedBy", "requester", "approver", "approverId", "approverPersonaId", "personaId"];
  const logs = sorted([
    ...["workflow-operator", "workflow-mcp"].flatMap((entrypoint) => fields.flatMap(
      (field) => ["missing", "blank"].flatMap((variant) => [
        `real-surface/logs/preflight-${entrypoint}-${field.toLowerCase()}-${variant}.stdout.log`,
        `real-surface/logs/preflight-${entrypoint}-${field.toLowerCase()}-${variant}.stderr.log`,
      ]),
    )),
    ...services.flatMap((service) => [
      `real-surface/logs/${service}.stdout.log`,
      `real-surface/logs/${service}.stderr.log`,
    ]),
    "real-surface/logs/workflow-mcp-probe.stdout.log",
    "real-surface/logs/workflow-mcp-probe.stderr.log",
    "real-surface/logs/engineer-mcp-probe.stdout.log",
    "real-surface/logs/engineer-mcp-probe.stderr.log",
    "real-surface/logs/web-build.stdout.log",
    "real-surface/logs/web-build.stderr.log",
  ]);
  const requests = sorted([
    "workflow-mcp-probe-unauthenticated",
    "engineer-mcp-probe-unauthenticated",
    "web-login-missing-secret",
    "api-bypass-header-denied",
    "api-tools-finance-forbidden",
    ...identityFields.flatMap((field) => ["root", "object", "array"].map(
      (location) => `api-tools-identity-conflict-${field}-${location}`,
    )),
    "workflow-operator-health-not-ready",
    "workflow-operator-health-ready",
    "engineer-bridge-health-not-ready",
    "engineer-bridge-health-ready",
    "engineer-operator-health-not-ready",
    "engineer-operator-health-ready",
    "api-cfo-missing-key",
    "api-cfo-wrong-key",
    "workflow-config-missing-key",
    "workflow-config-wrong-key",
    "engineer-bridge-tools-missing-key",
    "engineer-bridge-tools-wrong-key",
    "engineer-operator-summary-missing-key",
    "engineer-operator-summary-wrong-key",
    "api-tools-shared-key-positive",
    "api-tools-call-shared-key-positive",
    "engineer-bridge-equal-identity-positive",
    "api-finance-context-forbidden",
    "api-spoofed-actor",
    "api-external-finance-contained",
    "workflow-spoofed-approver",
    "engineer-bridge-spoofed-actor",
    "engineer-bridge-mutation-contained",
    "engineer-operator-spoofed-actor",
    "workflow-breakglass-contained",
  ].map((name) => `real-surface/requests/${name}.json`));
  const base = [
    "negative-matrix.json", "side-effect-spies.json", "restore-refusal.txt",
    "readiness-workflow-focused.log", "readiness-engineer-focused.log",
    "post-gate32-business-focused.log", "focused-evidence-index.json",
    "generated-pptx/Sangfor_설정가이드_MCP.pptx", "source-integrity-before.json",
    "source-integrity-after.json", "real-surface/processes.json",
    "real-surface/web-env-read-audit.json", "real-surface/observed-counters.json",
    "real-surface/cleanup.json", "real-surface/runner-tmpdir.json",
    "real-surface/unsafe-configuration-preflight.json", "real-surface/mcp-negative-surface.json",
    "real-surface/port-preflight.json", "real-surface/web-build.json",
    "real-surface/captures/api-to-infra.json", "real-surface/captures/bridge-to-child.json",
    "real-surface/result.json", "surface-qa.md",
  ];

  assert.equal(logs.length, 48);
  assert.equal(requests.length, 54);
  assert.equal(FINALIZATION_ARTIFACT_PATHS.length, 125);
  assert.deepEqual(FINALIZATION_ARTIFACT_PATHS, sorted([...base, ...logs, ...requests]));
});

function writeCanonicalJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fileRecord(root, path) {
  const bytes = readFileSync(resolve(root, path));
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

function renderFinalizationReview(role, manifest, manifestRecord) {
  return [
    "# U002 Gate37 fixture review",
    "",
    "Result: PASS",
    `Review role: ${role}`,
    `Finalization manifest: path=${manifestRecord.path} sha256=${manifestRecord.sha256} bytes=${manifestRecord.bytes}`,
    `Run ID: ${manifest.runId}`,
    `RunContext: ${JSON.stringify(manifest.runContext)}`,
    `Authority body SHA-256: ${manifest.authority.bodySha256}`,
    `Authority dispatch SHA-256: ${manifest.authority.dispatchSha256}`,
    `Authority Gate36 section SHA-256: ${manifest.gate36SectionSha256}`,
    `Authority Gate37 section SHA-256: ${manifest.gate37SectionSha256}`,
    `Authority Gate38 section SHA-256: ${manifest.gate38SectionSha256}`,
    `Authority Gate39 section SHA-256: ${manifest.gate39SectionSha256}`,
    `Authority Gate40 section SHA-256: ${manifest.gate40SectionSha256}`,
    `Authority Gate41 section SHA-256: ${manifest.gate41SectionSha256}`,
    `Source aggregate: count=${manifest.sourceAggregate.count} sha256=${manifest.sourceAggregate.sha256} bytes=${manifest.sourceAggregate.bytes}`,
    `Ports: ${JSON.stringify(manifest.ports)}`,
    "PPTX disposition: sourceAbsent=true",
    "Staged product paths: []",
    "Review provenance assurance: PROCEDURAL_LOCAL",
    "Residual state: MANUAL_EXTERNAL_PENDING",
    ...manifest.sourceAggregate.entries.map(
      (entry) => `Source: ${entry.path} sha256=${entry.sha256} bytes=${entry.bytes}`,
    ),
    ...manifest.artifacts.map(
      (entry) => `Artifact: ${entry.path} sha256=${entry.sha256} bytes=${entry.bytes}`,
    ),
    "",
  ].join("\n");
}

function writeFixtureHandoff(fixture, descriptor, overrides = {}) {
  const report = fileRecord(fixture.attemptDir, descriptor.report);
  const handoff = {
    schemaVersion: 1,
    unit: "U002",
    role: descriptor.role,
    verdict: "PASS",
    reviewOrder: descriptor.reviewOrder,
    taskId: descriptor.taskId,
    sessionId: descriptor.sessionId,
    runId: fixture.manifest.runId,
    runContext: fixture.manifest.runContext,
    ports: fixture.manifest.ports,
    finalizationManifest: fixture.manifestRecord,
    authority: fixture.manifest.authority,
    sourceAggregate: fixture.manifest.sourceAggregate,
    artifacts: fixture.manifest.artifacts,
    report,
    ...overrides,
  };
  writeCanonicalJson(resolve(fixture.attemptDir, `review-handoffs/${descriptor.name}`), handoff);
  return handoff;
}

function createFinalizerFixture() {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-gate37-finalizer-"));
  const sourceRoot = resolve(fixtureRoot, "repo");
  const attemptDir = resolve(fixtureRoot, "U002/attempt-5");
  mkdirSync(sourceRoot);
  mkdirSync(attemptDir, { recursive: true });
  for (const path of OWNED_PATHS) {
    const target = resolve(sourceRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `source:${path}\n`, "utf8");
  }
  execFileSync("git", ["init", "-q"], { cwd: sourceRoot, stdio: "ignore" });
  const sourceIntegrity = buildOwnedSourceManifest(sourceRoot, OWNED_PATHS);
  // Gate40: derive the synthetic run-start boundary from a filesystem clock
  // probe written immediately before the controller record so the boundary and
  // the validated file timestamps share one clock domain; the parser coverage
  // still exercises arbitrary canonical ns strings.
  const clockProbePath = resolve(fixtureRoot, "clock-probe");
  writeFileSync(clockProbePath, "u002-gate40-clock-probe\n", "utf8");
  const runContext = {
    expectedRunId: "run-gate37-fixture",
    expectedRunStartNs: statSync(clockProbePath, { bigint: true }).mtimeNs.toString(),
  };
  const controllerPath = resolve(attemptDir, "controller-run-context.json");
  writeCanonicalJson(controllerPath, {
    schemaVersion: 1,
    unit: "U002",
    runContext,
    priorRunIds: [],
  });
  chmodSync(controllerPath, 0o600);
  for (const path of FINALIZATION_ARTIFACT_PATHS) {
    if (["source-integrity-before.json", "source-integrity-after.json"].includes(path)) continue;
    const target = resolve(attemptDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `artifact:${path}\n`, "utf8");
  }
  writeCanonicalJson(resolve(attemptDir, "source-integrity-before.json"), sourceIntegrity);
  writeCanonicalJson(resolve(attemptDir, "source-integrity-after.json"), sourceIntegrity);
  const artifacts = buildOwnedSourceManifest(attemptDir, FINALIZATION_ARTIFACT_PATHS).entries;
  const ref = (path) => artifacts.find((entry) => entry.path === path);
  const sourceAggregate = {
    count: sourceIntegrity.count,
    entries: sourceIntegrity.entries,
    sha256: sourceIntegrity.aggregateSha256,
    bytes: sourceIntegrity.framingBytes,
  };
  const manifest = {
    schemaVersion: 1,
    unit: "U002",
    phase: "AWAITING_EXTERNAL_REVIEWS",
    runId: runContext.expectedRunId,
    runContext,
    authority: {
      bodySha256: "0adee3cb747f05a09f678aa22a909393c387248f99875bc00979141c8b596286",
      dispatchSha256: "832789e9cb93e08a7a0708f75106b1dc0b9d9bd4a3558fdce9428634fb52e841",
    },
    gate36SectionSha256: "570a71fc4a47cdf4cbb82339354b9b81759bb6b9876ddd02e6f41ab592e32345",
    gate37SectionSha256: "e8a2f2574e61269597c717d622c2d7766feb1e354b614a2bf34798c436af2983",
    gate38SectionSha256: "c68dd0b7e7e2adc25aed7c0d7fc6d93bbdce2a4fb2b0b0680d3e7bdb1bf4f331",
    gate39SectionSha256: "c958b0c824501f38257036dff426214471986dbf1073b0cb7284d2a3104ba436",
    gate40SectionSha256: "a0952272f05a237bf5b688835a5c8ecf53cf01a27f4f925b5e950f526910f276",
    gate41SectionSha256: "a5ec2720b1bb65ed659092f808a434fe05a460261d271eecd9a4762f59fac57d",
    ownership: { READ_ONLY: 8, MODIFY: 57, CREATE: 31, total: 96, writable: 88 },
    invocationCount: 1,
    ports: {
      web: 45101,
      api: 45102,
      "workflow-operator": 45103,
      "engineer-bridge": 45104,
      "engineer-operator": 45105,
    },
    sourceIntegrity: {
      before: ref("source-integrity-before.json"),
      after: ref("source-integrity-after.json"),
    },
    sourceAggregate,
    focusedLogs: {
      workflow: ref("readiness-workflow-focused.log"),
      engineer: ref("readiness-engineer-focused.log"),
      business: ref("post-gate32-business-focused.log"),
      testCounts: { workflow: 1, engineer: 1, business: 1 },
    },
    lifecycle: {
      processes: ref("real-surface/processes.json"),
      cleanup: ref("real-surface/cleanup.json"),
      result: ref("real-surface/result.json"),
    },
    captures: {
      apiToInfra: ref("real-surface/captures/api-to-infra.json"),
      bridgeToChild: ref("real-surface/captures/bridge-to-child.json"),
    },
    observedCounters: ref("real-surface/observed-counters.json"),
    webEnvReadAudit: ref("real-surface/web-env-read-audit.json"),
    pptx: {
      ...ref("generated-pptx/Sangfor_설정가이드_MCP.pptx"),
      sourceAbsent: true,
    },
    stagedProductPaths: [],
    artifacts,
    residualState: "MANUAL_EXTERNAL_PENDING",
  };
  const manifestPath = resolve(attemptDir, "finalization-manifest.json");
  writeCanonicalJson(manifestPath, manifest);
  const fixture = {
    fixtureRoot,
    sourceRoot,
    attemptDir,
    sourceIntegrity,
    runContext,
    manifest,
    manifestRecord: fileRecord(attemptDir, "finalization-manifest.json"),
    cleanup() {
      rmSync(fixtureRoot, { recursive: true, force: true });
    },
  };
  mkdirSync(resolve(attemptDir, "review-handoffs"));
  const surfaceDescriptor = {
    name: "surface-qa.json",
    role: "surface-qa",
    reviewOrder: 1,
    taskId: "task-surface",
    sessionId: "session-surface",
    report: "surface-qa-review.md",
  };
  const finalDescriptor = {
    name: "final-code.json",
    role: "final-code",
    reviewOrder: 2,
    taskId: "task-code",
    sessionId: "session-code",
    report: "final-code-review.md",
  };
  writeFileSync(
    resolve(attemptDir, surfaceDescriptor.report),
    renderFinalizationReview(surfaceDescriptor.role, manifest, fixture.manifestRecord),
    "utf8",
  );
  fixture.surfaceHandoff = writeFixtureHandoff(fixture, surfaceDescriptor);
  writeFileSync(
    resolve(attemptDir, finalDescriptor.report),
    renderFinalizationReview(finalDescriptor.role, manifest, fixture.manifestRecord),
    "utf8",
  );
  fixture.finalHandoff = writeFixtureHandoff(fixture, finalDescriptor);
  fixture.surfaceDescriptor = surfaceDescriptor;
  fixture.finalDescriptor = finalDescriptor;
  return fixture;
}

function resetFinalizerFixtureForFreshRunner(fixture) {
  for (const entry of readdirSync(fixture.attemptDir)) {
    if (entry === "controller-run-context.json") continue;
    rmSync(resolve(fixture.attemptDir, entry), { recursive: true, force: true });
  }
}

function finalizeFixture(fixture, options = {}) {
  return finalizeU002Receipt(fixture.attemptDir, {
    sourceRoot: fixture.sourceRoot,
    expectedRunId: fixture.runContext.expectedRunId,
    expectedRunStartNs: fixture.runContext.expectedRunStartNs,
    ...options,
  });
}

function rewriteCanonical(path, mutate) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeCanonicalJson(path, value);
}

function rebindFixtureRunContext(fixture, runContext) {
  fixture.runContext = runContext;
  fixture.manifest.runId = runContext.expectedRunId;
  fixture.manifest.runContext = runContext;
  rewriteCanonical(resolve(fixture.attemptDir, "controller-run-context.json"), (controller) => {
    controller.runContext = runContext;
  });
  writeCanonicalJson(resolve(fixture.attemptDir, "finalization-manifest.json"), fixture.manifest);
  fixture.manifestRecord = fileRecord(fixture.attemptDir, "finalization-manifest.json");
  writeFileSync(
    resolve(fixture.attemptDir, fixture.surfaceDescriptor.report),
    renderFinalizationReview(fixture.surfaceDescriptor.role, fixture.manifest, fixture.manifestRecord),
    "utf8",
  );
  fixture.surfaceHandoff = writeFixtureHandoff(fixture, fixture.surfaceDescriptor);
  writeFileSync(
    resolve(fixture.attemptDir, fixture.finalDescriptor.report),
    renderFinalizationReview(fixture.finalDescriptor.role, fixture.manifest, fixture.manifestRecord),
    "utf8",
  );
  fixture.finalHandoff = writeFixtureHandoff(fixture, fixture.finalDescriptor);
}

function replaceWithSameBytes(path) {
  const bytes = readFileSync(path);
  unlinkSync(path);
  writeFileSync(path, bytes);
}

function finalizerClockProbeNames(attemptDir) {
  return readdirSync(attemptDir).filter((name) => name.startsWith(".u002-finalizer-clock-"));
}

function withPreparedAttemptRootSwapAfterProbe(fixture, run) {
  const attemptRoot = resolve(fixture.attemptDir);
  const preparedRoot = resolve(fixture.fixtureRoot, "prepared-attempt-root");
  const parkedRoot = resolve(fixture.fixtureRoot, "parked-probe-root");
  renameSync(attemptRoot, preparedRoot);
  mkdirSync(attemptRoot);
  const originalRoot = lstatSync(attemptRoot, { bigint: true });
  const replacementRoot = lstatSync(preparedRoot, { bigint: true });
  const originalLstatSync = mutableFs.lstatSync;
  let attemptRootLstats = 0;
  let sawProbePath = false;
  let swapped = false;
  mutableFs.lstatSync = function injectedRootSwap(path, ...args) {
    const metadata = originalLstatSync.call(this, path, ...args);
    const absolutePath = resolve(path);
    if (absolutePath.startsWith(`${attemptRoot}/.u002-finalizer-clock-`)) {
      sawProbePath = true;
    }
    if (absolutePath === attemptRoot) {
      attemptRootLstats += 1;
      if (sawProbePath && !swapped) {
        renameSync(attemptRoot, parkedRoot);
        renameSync(preparedRoot, attemptRoot);
        swapped = true;
      }
    }
    return metadata;
  };
  syncBuiltinESMExports();
  try {
    const result = run();
    return {
      result,
      swapped,
      attemptRootLstats,
      originalInode: originalRoot.ino,
      replacementInode: replacementRoot.ino,
    };
  } finally {
    mutableFs.lstatSync = originalLstatSync;
    syncBuiltinESMExports();
  }
}

function withAttemptRootSwapImmediatelyAfterReceiptLink(fixture, run) {
  const attemptRoot = resolve(fixture.attemptDir);
  const parkedRoot = resolve(fixture.fixtureRoot, "parked-post-link-root");
  let callbackCalls = 0;
  let swapped = false;
  let result;
  let error;
  const afterReceiptLink = () => {
    callbackCalls += 1;
    if (callbackCalls !== 1) return;
    renameSync(attemptRoot, parkedRoot);
    mkdirSync(attemptRoot);
    swapped = true;
  };
  try {
    result = run({ afterReceiptLink });
  } catch (caught) {
    error = caught;
  }
  return { callbackCalls, error, parkedRoot, result, swapped };
}

function withDirFdLinkAcknowledgementLoss(run) {
  const originalSpawnSync = mutableChildProcess.spawnSync;
  let injected = false;
  let result;
  let error;
  mutableChildProcess.spawnSync = function loseSuccessfulLinkAcknowledgement(
    executable,
    args,
    options,
  ) {
    const child = originalSpawnSync.call(this, executable, args, options);
    const request = parseDirFdOperation(options) === "link"
      ? JSON.parse(String(options.input))
      : undefined;
    if (
      !injected
      && executable === "/usr/bin/python3"
      && child.status === 0
      && request?.destination === "receipt.json"
    ) {
      injected = true;
      return {
        ...child,
        stdout: '{"error":null,"ok":true,"op":"link","result":{}}\n',
      };
    }
    return child;
  };
  syncBuiltinESMExports();
  try {
    result = run();
  } catch (caught) {
    error = caught;
  } finally {
    mutableChildProcess.spawnSync = originalSpawnSync;
    syncBuiltinESMExports();
  }
  return { error, injected, result };
}

function withAttemptRootSwapImmediatelyAfterEvidenceDirectory(fixture, evidenceDir, run) {
  const attemptRoot = resolve(fixture.attemptDir);
  const targetDirectory = resolve(evidenceDir);
  const parkedRoot = resolve(fixture.fixtureRoot, "parked-runner-root");
  const originalMkdirSync = mutableFs.mkdirSync;
  let swapped = false;
  mutableFs.mkdirSync = function swapAttemptRootAfterEvidenceDirectory(path, ...args) {
    const created = originalMkdirSync.call(this, path, ...args);
    if (!swapped && typeof path === "string" && resolve(path) === targetDirectory) {
      renameSync(attemptRoot, parkedRoot);
      originalMkdirSync.call(this, attemptRoot);
      swapped = true;
    }
    return created;
  };
  syncBuiltinESMExports();
  try {
    return { parkedRoot, result: run(), swapped };
  } finally {
    mutableFs.mkdirSync = originalMkdirSync;
    syncBuiltinESMExports();
  }
}

function parseDirFdOperation(options) {
  if (typeof options?.input !== "string" && !Buffer.isBuffer(options?.input)) return undefined;
  try {
    return JSON.parse(String(options.input)).op;
  } catch {
    return undefined;
  }
}

function withAttemptRootSwapAtReceiptWriteOperation(fixture, run) {
  const attemptRoot = resolve(fixture.attemptDir);
  const parkedRoot = resolve(fixture.fixtureRoot, "parked-write-operation-root");
  const originalOpenSync = mutableFs.openSync;
  const originalSpawnSync = mutableChildProcess.spawnSync;
  let swapped = false;
  let helperProtocol;
  let result;
  let error;
  const swapRoot = () => {
    renameSync(attemptRoot, parkedRoot);
    mkdirSync(attemptRoot);
    swapped = true;
  };
  mutableFs.openSync = function swapBeforeReceiptTempOpen(path, ...args) {
    if (
      !swapped
      && typeof path === "string"
      && resolve(path).startsWith(`${attemptRoot}/receipt.json.tmp-`)
    ) {
      swapRoot();
    }
    return originalOpenSync.call(this, path, ...args);
  };
  mutableChildProcess.spawnSync = function swapBeforeDirFdWrite(executable, args, options) {
    const request = parseDirFdOperation(options) === "write"
      ? JSON.parse(String(options.input))
      : undefined;
    if (
      !swapped
      && executable === "/usr/bin/python3"
      && request
    ) {
      swapRoot();
    }
    const child = originalSpawnSync.call(this, executable, args, options);
    if (request) {
      const response = JSON.parse(String(child.stdout));
      helperProtocol = {
        args: args.slice(0, 3),
        cwd: options.cwd,
        envKeys: Object.keys(options.env).sort(),
        executable,
        heldDescriptorMapped: Number.isInteger(options.stdio?.[3]) && options.stdio[3] > 2,
        inlineSource: args.length === 4 && typeof args[3] === "string" && args[3].length > 0,
        inputCanonical: String(options.input) === `${JSON.stringify(request)}\n`,
        inputLeaksAttemptPath: String(options.input).includes(attemptRoot),
        requestKeys: Object.keys(request),
        requestNameIsBasename: !request.name.includes("/") && !request.name.includes("\\"),
        responseKeys: Object.keys(response),
        responseLeaksAttemptPath: String(child.stdout).includes(attemptRoot),
        shell: options.shell,
        status: child.status,
        stderr: child.stderr,
        stdio: options.stdio.slice(0, 3),
      };
    }
    return child;
  };
  syncBuiltinESMExports();
  try {
    result = run();
  } catch (caught) {
    error = caught;
  } finally {
    mutableFs.openSync = originalOpenSync;
    mutableChildProcess.spawnSync = originalSpawnSync;
    syncBuiltinESMExports();
  }
  return { error, helperProtocol, parkedRoot, result, swapped };
}

async function withRunnerCleanupRootMove(fixture, evidenceDir, run) {
  const attemptRoot = resolve(fixture.attemptDir);
  const targetDirectory = resolve(evidenceDir);
  const parkedRoot = resolve(fixture.fixtureRoot, "parked-cleanup-path-root");
  const heldRoot = resolve(fixture.fixtureRoot, "held-cleanup-operation-root");
  const originalMkdirSync = mutableFs.mkdirSync;
  const originalRmSync = mutableFs.rmSync;
  const originalSpawnSync = mutableChildProcess.spawnSync;
  let firstSwap = false;
  let cleanupSwap = false;
  let helperProtocol;
  let result;
  let error;
  const moveHeldRootAgain = () => {
    renameSync(parkedRoot, heldRoot);
    originalMkdirSync.call(mutableFs, parkedRoot);
    cleanupSwap = true;
  };
  mutableFs.mkdirSync = function swapAfterEvidenceDirectory(path, ...args) {
    const created = originalMkdirSync.call(this, path, ...args);
    if (!firstSwap && typeof path === "string" && resolve(path) === targetDirectory) {
      renameSync(attemptRoot, parkedRoot);
      originalMkdirSync.call(this, attemptRoot);
      firstSwap = true;
    }
    return created;
  };
  mutableFs.rmSync = function moveRootBeforeResolvedCleanup(path, ...args) {
    if (
      firstSwap
      && !cleanupSwap
      && typeof path === "string"
      && path.endsWith("/parked-cleanup-path-root/new-real-surface")
    ) {
      moveHeldRootAgain();
    }
    return originalRmSync.call(this, path, ...args);
  };
  mutableChildProcess.spawnSync = function moveRootBeforeDirFdCleanup(executable, args, options) {
    const request = parseDirFdOperation(options) === "remove_tree"
      ? JSON.parse(String(options.input))
      : undefined;
    if (
      firstSwap
      && !cleanupSwap
      && executable === "/usr/bin/python3"
      && request?.name === "new-real-surface"
    ) {
      moveHeldRootAgain();
    }
    const child = originalSpawnSync.call(this, executable, args, options);
    if (request?.name === "new-real-surface") {
      helperProtocol = {
        heldDescriptorMapped: Number.isInteger(options.stdio?.[3]) && options.stdio[3] > 2,
        inputLeaksAttemptPath: String(options.input).includes(attemptRoot),
        request,
        responseLeaksAttemptPath: String(child.stdout).includes(attemptRoot),
        shell: options.shell,
        status: child.status,
        stderr: child.stderr,
      };
    }
    return child;
  };
  syncBuiltinESMExports();
  try {
    result = await run();
  } catch (caught) {
    error = caught;
  } finally {
    mutableFs.mkdirSync = originalMkdirSync;
    mutableFs.rmSync = originalRmSync;
    mutableChildProcess.spawnSync = originalSpawnSync;
    syncBuiltinESMExports();
  }
  return { cleanupSwap, error, firstSwap, heldRoot, helperProtocol, parkedRoot, result };
}

function installDescriptorCloseFault(fixture, { allStableDescriptors = false } = {}) {
  const attemptRoot = resolve(fixture.attemptDir);
  const sourceRoot = resolve(fixture.sourceRoot);
  const controllerPath = resolve(attemptRoot, "controller-run-context.json");
  const originals = {
    openSync: mutableFs.openSync,
    closeSync: mutableFs.closeSync,
  };
  const stableDescriptors = new Set();
  const attemptedStableCloses = new Set();
  let rootDescriptor;
  let rootCloseAttempted = false;
  let injected = false;
  mutableFs.openSync = function trackDescriptors(path, ...args) {
    const descriptor = originals.openSync.call(this, path, ...args);
    if (typeof path !== "string") return descriptor;
    const absolutePath = resolve(path);
    if (absolutePath === attemptRoot && rootDescriptor === undefined) {
      rootDescriptor = descriptor;
    } else if (
      absolutePath === controllerPath
      || (
        allStableDescriptors
        && (absolutePath.startsWith(`${attemptRoot}/`) || absolutePath.startsWith(`${sourceRoot}/`))
        && !absolutePath.startsWith(`${attemptRoot}/.u002-finalizer-clock-`)
        && !absolutePath.startsWith(`${attemptRoot}/receipt.json.tmp-`)
      )
    ) {
      stableDescriptors.add(descriptor);
    }
    return descriptor;
  };
  mutableFs.closeSync = function injectFirstStableCloseFailure(descriptor, ...args) {
    if (descriptor === rootDescriptor) rootCloseAttempted = true;
    if (stableDescriptors.has(descriptor)) {
      attemptedStableCloses.add(descriptor);
      const result = originals.closeSync.call(this, descriptor, ...args);
      if (!injected) {
        injected = true;
        const error = new Error("injected-stable-descriptor-close-failure");
        error.code = "EIO";
        throw error;
      }
      return result;
    }
    return originals.closeSync.call(this, descriptor, ...args);
  };
  syncBuiltinESMExports();
  return {
    restore() {
      Object.assign(mutableFs, originals);
      syncBuiltinESMExports();
    },
    trace() {
      return {
        attemptedStableCloses: attemptedStableCloses.size,
        injected,
        rootCloseAttempted,
        stableDescriptors: stableDescriptors.size,
      };
    },
  };
}

function withInjectedClockProbeFailure(fixture, operation, run) {
  const attemptRoot = resolve(fixture.attemptDir);
  const originals = {
    openSync: mutableFs.openSync,
    writeFileSync: mutableFs.writeFileSync,
    fsyncSync: mutableFs.fsyncSync,
    fstatSync: mutableFs.fstatSync,
    unlinkSync: mutableFs.unlinkSync,
    closeSync: mutableFs.closeSync,
  };
  let rootDescriptor;
  let probeDescriptor;
  let injected = false;
  const fault = () => {
    injected = true;
    const error = new Error(`injected-${operation}-failure`);
    error.code = "EIO";
    throw error;
  };
  mutableFs.openSync = function trackClockDescriptors(path, ...args) {
    const descriptor = originals.openSync.call(this, path, ...args);
    if (typeof path === "string") {
      const absolutePath = resolve(path);
      if (absolutePath === attemptRoot) rootDescriptor = descriptor;
      if (absolutePath.startsWith(`${attemptRoot}/.u002-finalizer-clock-`)) {
        probeDescriptor = descriptor;
      }
    }
    return descriptor;
  };
  if (operation === "write") {
    mutableFs.writeFileSync = function injectProbeWrite(descriptor, ...args) {
      if (!injected && descriptor === probeDescriptor) return fault();
      return originals.writeFileSync.call(this, descriptor, ...args);
    };
  } else if (operation === "file-fsync" || operation === "dir-fsync") {
    mutableFs.fsyncSync = function injectProbeFsync(descriptor, ...args) {
      const target = operation === "file-fsync" ? probeDescriptor : rootDescriptor;
      if (!injected && descriptor === target) {
        originals.fsyncSync.call(this, descriptor, ...args);
        return fault();
      }
      return originals.fsyncSync.call(this, descriptor, ...args);
    };
  } else if (operation === "fstat") {
    mutableFs.fstatSync = function injectProbeFstat(descriptor, ...args) {
      if (!injected && descriptor === probeDescriptor) return fault();
      return originals.fstatSync.call(this, descriptor, ...args);
    };
  } else if (operation === "unlink") {
    mutableFs.unlinkSync = function injectProbeUnlink(path, ...args) {
      if (
        !injected
        && typeof path === "string"
        && resolve(path).startsWith(`${attemptRoot}/.u002-finalizer-clock-`)
      ) {
        return fault();
      }
      return originals.unlinkSync.call(this, path, ...args);
    };
  } else if (operation === "close") {
    mutableFs.closeSync = function injectProbeClose(descriptor, ...args) {
      if (!injected && descriptor === probeDescriptor) {
        originals.closeSync.call(this, descriptor, ...args);
        return fault();
      }
      return originals.closeSync.call(this, descriptor, ...args);
    };
  } else {
    throw new Error(`unknown clock probe operation: ${operation}`);
  }
  syncBuiltinESMExports();
  try {
    return { result: run(), injected };
  } finally {
    Object.assign(mutableFs, originals);
    syncBuiltinESMExports();
  }
}

function withClockProbePathSwapAtUnlink(fixture, run) {
  const attemptRoot = resolve(fixture.attemptDir);
  const parkedProbe = resolve(fixture.fixtureRoot, "parked-original-clock-probe");
  const originalUnlinkSync = mutableFs.unlinkSync;
  let swapped = false;
  mutableFs.unlinkSync = function swapClockProbeBeforeUnlink(path, ...args) {
    if (
      !swapped
      && typeof path === "string"
      && resolve(path).startsWith(`${attemptRoot}/.u002-finalizer-clock-`)
    ) {
      renameSync(path, parkedProbe);
      writeFileSync(path, "replacement-clock-probe\n", { encoding: "utf8", mode: 0o600 });
      swapped = true;
    }
    return originalUnlinkSync.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  try {
    return { result: run(), swapped, parkedProbe };
  } finally {
    mutableFs.unlinkSync = originalUnlinkSync;
    syncBuiltinESMExports();
  }
}

function withClockProbeTimestamp(attemptDir, timestampNs, run) {
  const attemptRoot = resolve(attemptDir);
  const originals = {
    openSync: mutableFs.openSync,
    fstatSync: mutableFs.fstatSync,
    lstatSync: mutableFs.lstatSync,
    closeSync: mutableFs.closeSync,
  };
  let probeDescriptor;
  const applyTimestamp = (metadata) => {
    Object.defineProperties(metadata, {
      mtimeNs: { configurable: true, value: timestampNs },
      ctimeNs: { configurable: true, value: timestampNs },
    });
    return metadata;
  };
  mutableFs.openSync = function trackClockProbe(path, ...args) {
    const descriptor = originals.openSync.call(this, path, ...args);
    if (
      typeof path === "string"
      && resolve(path).startsWith(`${attemptRoot}/.u002-finalizer-clock-`)
    ) {
      probeDescriptor = descriptor;
    }
    return descriptor;
  };
  mutableFs.fstatSync = function bindClockProbeDescriptorTimestamp(descriptor, ...args) {
    const metadata = originals.fstatSync.call(this, descriptor, ...args);
    return descriptor === probeDescriptor ? applyTimestamp(metadata) : metadata;
  };
  mutableFs.lstatSync = function bindClockProbePathTimestamp(path, ...args) {
    const metadata = originals.lstatSync.call(this, path, ...args);
    return (
      typeof path === "string"
      && resolve(path).startsWith(`${attemptRoot}/.u002-finalizer-clock-`)
    ) ? applyTimestamp(metadata) : metadata;
  };
  mutableFs.closeSync = function releaseClockProbeDescriptor(descriptor, ...args) {
    const result = originals.closeSync.call(this, descriptor, ...args);
    if (descriptor === probeDescriptor) probeDescriptor = undefined;
    return result;
  };
  syncBuiltinESMExports();
  try {
    return run();
  } finally {
    Object.assign(mutableFs, originals);
    syncBuiltinESMExports();
  }
}

function receiptTemporaryNames(attemptDir) {
  return readdirSync(attemptDir).filter((name) => name.startsWith("receipt.json.tmp-"));
}

function runFinalizerChild(fixture) {
  const moduleUrl = pathToFileURL(resolve(repoRoot, "scripts/check-u002-containment-surface.mjs")).href;
  const program = `import { finalizeU002Receipt } from ${JSON.stringify(moduleUrl)};\ntry { finalizeU002Receipt(process.env.ATTEMPT_DIR, { sourceRoot: process.env.SOURCE_ROOT, expectedRunId: process.env.EXPECTED_RUN_ID, expectedRunStartNs: process.env.EXPECTED_RUN_START_NS }); process.stdout.write("PASS\\n"); } catch (error) { process.stderr.write(String(error.code ?? error.message) + "\\n"); process.exitCode = error.exitCode ?? 1; }`;
  return new Promise((resolveChild) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", program], {
      cwd: fixture.sourceRoot,
      env: {
        ...process.env,
        ATTEMPT_DIR: fixture.attemptDir,
        SOURCE_ROOT: fixture.sourceRoot,
        EXPECTED_RUN_ID: fixture.runContext.expectedRunId,
        EXPECTED_RUN_START_NS: fixture.runContext.expectedRunStartNs,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("exit", (status, signal) => resolveChild({ status, signal, stdout, stderr }));
  });
}

test("Gate36 finalizer accepts the exact complete descriptor-bound contract", () => {
  const fixture = createFinalizerFixture();
  try {
    const receipt = finalizeFixture(fixture);

    assert.equal(receipt.result, "PASS");
    assert.equal(receipt.reviewProvenanceAssurance, "PROCEDURAL_LOCAL");
    assert.equal(receipt.residualState, "MANUAL_EXTERNAL_PENDING");
    assert.equal(receipt.gate36SectionSha256, fixture.manifest.gate36SectionSha256);
    assert.equal(receipt.gate37SectionSha256, fixture.manifest.gate37SectionSha256);
    assert.equal(receipt.gate38SectionSha256, fixture.manifest.gate38SectionSha256);
    assert.equal(receipt.gate39SectionSha256, fixture.manifest.gate39SectionSha256);
    assert.equal(receipt.sourceAggregate.entries.length, 96);
    assert.equal(receipt.sourceAggregate.bytes, fixture.manifest.sourceAggregate.bytes);
    assert.deepEqual(receipt.artifacts, fixture.manifest.artifacts);
    assert.deepEqual(receipt.ports, fixture.manifest.ports);
    assert.equal(statSync(resolve(fixture.attemptDir, "receipt.json")).mode & 0o777, 0o600);
    assert.deepEqual(receiptTemporaryNames(fixture.attemptDir), []);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 runner rejects a prepared attempt-root replacement after the clock probe observation", () => {
  const fixture = createFinalizerFixture();
  try {
    let accepted = false;
    let errorCode;
    const trace = withPreparedAttemptRootSwapAfterProbe(fixture, () => {
      try {
        validateRunnerRunContext(fixture.attemptDir, fixture.runContext);
        accepted = true;
      } catch (error) {
        errorCode = error.code;
      }
    });

    assert.notEqual(trace.originalInode, trace.replacementInode);
    assert.deepEqual({
      swapped: trace.swapped,
      accepted,
      errorCode,
      receiptExists: existsSync(resolve(fixture.attemptDir, "receipt.json")),
      probeNames: finalizerClockProbeNames(fixture.attemptDir),
      temporaryNames: receiptTemporaryNames(fixture.attemptDir),
    }, {
      swapped: true,
      accepted: false,
      errorCode: "FINALIZATION_PATH_ANCESTOR_CHANGED",
      receiptExists: false,
      probeNames: [],
      temporaryNames: [],
    });
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 real-surface runner rejects a prepared attempt-root replacement before lifecycle writes", async () => {
  const fixture = createFinalizerFixture();
  try {
    for (const path of [
      "finalization-manifest.json",
      "surface-qa-review.md",
      "final-code-review.md",
      "review-handoffs/surface-qa.json",
      "review-handoffs/final-code.json",
    ]) {
      unlinkSync(resolve(fixture.attemptDir, path));
    }
    const trace = withPreparedAttemptRootSwapAfterProbe(fixture, () => runRealSurface({
      runId: fixture.runContext.expectedRunId,
      runContext: fixture.runContext,
      evidenceDir: resolve(fixture.attemptDir, "new-real-surface"),
      node20Bin: "/invalid-node20-not-reached",
      node22Bin: "/invalid-node22-not-reached",
      ports: fixture.manifest.ports,
    }));

    await assert.rejects(trace.result, (error) => {
      assert.equal(error.code, "FINALIZATION_PATH_ANCESTOR_CHANGED");
      return true;
    });
    assert.notEqual(trace.originalInode, trace.replacementInode);
    assert.equal(trace.swapped, true);
    assert.equal(existsSync(resolve(fixture.attemptDir, "new-real-surface")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    assert.deepEqual(finalizerClockProbeNames(fixture.attemptDir), []);
    assert.deepEqual(receiptTemporaryNames(fixture.attemptDir), []);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer rejects a prepared attempt-root replacement after the clock probe observation", () => {
  const fixture = createFinalizerFixture();
  try {
    let accepted = false;
    let errorCode;
    const trace = withPreparedAttemptRootSwapAfterProbe(fixture, () => {
      try {
        finalizeFixture(fixture);
        accepted = true;
      } catch (error) {
        errorCode = error.code;
      }
    });

    assert.notEqual(trace.originalInode, trace.replacementInode);
    assert.deepEqual({
      swapped: trace.swapped,
      accepted,
      errorCode,
      receiptExists: existsSync(resolve(fixture.attemptDir, "receipt.json")),
      probeNames: finalizerClockProbeNames(fixture.attemptDir),
      temporaryNames: receiptTemporaryNames(fixture.attemptDir),
    }, {
      swapped: true,
      accepted: false,
      errorCode: "FINALIZATION_PATH_ANCESTOR_CHANGED",
      receiptExists: false,
      probeNames: [],
      temporaryNames: [],
    });
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer cleans the held original root after replacement immediately follows the receipt link", () => {
  const fixture = createFinalizerFixture();
  try {
    const trace = withAttemptRootSwapImmediatelyAfterReceiptLink(
      fixture,
      (options) => finalizeFixture(fixture, options),
    );
    const finalization = {
      callbackCalls: trace.callbackCalls,
      swapped: trace.swapped,
      returned: trace.result !== undefined,
      errorCode: trace.error?.code ?? null,
    };

    assert.deepEqual(finalization, {
      callbackCalls: 1,
      swapped: true,
      returned: false,
      errorCode: "FINALIZATION_PATH_ANCESTOR_CHANGED",
    }, `post-link finalizer trace: ${JSON.stringify({
      ...finalization,
      errorMessage: trace.error instanceof Error ? trace.error.message : null,
    })}`);
    assert.deepEqual({
      currentReceipt: existsSync(resolve(fixture.attemptDir, "receipt.json")),
      currentTemporaries: receiptTemporaryNames(fixture.attemptDir),
      parkedReceipt: existsSync(resolve(trace.parkedRoot, "receipt.json")),
      parkedTemporaries: receiptTemporaryNames(trace.parkedRoot),
    }, {
      currentReceipt: false,
      currentTemporaries: [],
      parkedReceipt: false,
      parkedTemporaries: [],
    });
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer cleans a receipt when the dir-fd link succeeds without a valid acknowledgement", () => {
  const fixture = createFinalizerFixture();
  try {
    const trace = withDirFdLinkAcknowledgementLoss(() => finalizeFixture(fixture));

    assert.equal(trace.injected, true);
    assert.equal(trace.result, undefined);
    assert.equal(trace.error?.code, "FINALIZATION_DIR_FD_PROTOCOL_INVALID");
    assert.deepEqual({
      receipt: existsSync(resolve(fixture.attemptDir, "receipt.json")),
      temporaries: receiptTemporaryNames(fixture.attemptDir),
    }, {
      receipt: false,
      temporaries: [],
    });
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer keeps receipt temp creation on the held root when the resolved pathname is replaced", () => {
  // Given: the attempt pathname is replaced immediately before the real temp-file write operation.
  const fixture = createFinalizerFixture();
  try {
    // When: finalization reaches either the legacy pathname open or the Darwin dir-fd write helper.
    const trace = withAttemptRootSwapAtReceiptWriteOperation(fixture, () => finalizeFixture(fixture));

    // Then: rejection is exact and neither the replacement nor held original retains receipt state.
    assert.equal(trace.swapped, true);
    assert.equal(trace.result, undefined);
    assert.equal(trace.error?.code, "FINALIZATION_PATH_ANCESTOR_CHANGED");
    assert.deepEqual(trace.helperProtocol, {
      args: ["-I", "-S", "-c"],
      cwd: "/",
      envKeys: ["LANG", "LC_ALL", "PATH"],
      executable: "/usr/bin/python3",
      heldDescriptorMapped: true,
      inlineSource: true,
      inputCanonical: true,
      inputLeaksAttemptPath: false,
      requestKeys: ["data", "name", "op"],
      requestNameIsBasename: true,
      responseKeys: ["error", "ok", "op", "result"],
      responseLeaksAttemptPath: false,
      shell: false,
      status: 0,
      stderr: "",
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.deepEqual({
      currentReceipt: existsSync(resolve(fixture.attemptDir, "receipt.json")),
      currentTemporaries: receiptTemporaryNames(fixture.attemptDir),
      parkedReceipt: existsSync(resolve(trace.parkedRoot, "receipt.json")),
      parkedTemporaries: receiptTemporaryNames(trace.parkedRoot),
    }, {
      currentReceipt: false,
      currentTemporaries: [],
      parkedReceipt: false,
      parkedTemporaries: [],
    });
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 real-surface runner cleans its held-root evidence directory after root replacement", async () => {
  const fixture = createFinalizerFixture();
  try {
    resetFinalizerFixtureForFreshRunner(fixture);
    const evidenceDir = resolve(fixture.attemptDir, "new-real-surface");
    const ports = await reserveServicePorts();
    const trace = withAttemptRootSwapImmediatelyAfterEvidenceDirectory(
      fixture,
      evidenceDir,
      () => runRealSurface({
        runId: fixture.runContext.expectedRunId,
        runContext: fixture.runContext,
        evidenceDir,
        node20Bin: "/Users/jmpark/.nvm/versions/node/v20.20.2/bin/node",
        node22Bin: "/Users/jmpark/.nvm/versions/node/v22.23.0/bin/node",
        ports,
      }),
    );

    await assert.rejects(trace.result, (error) => {
      assert.equal(error.code, "FINALIZATION_PATH_ANCESTOR_CHANGED");
      return true;
    });
    assert.equal(trace.swapped, true);
    assert.deepEqual({
      currentEvidence: existsSync(resolve(fixture.attemptDir, "new-real-surface")),
      parkedEvidence: existsSync(resolve(trace.parkedRoot, "new-real-surface")),
      currentReceipt: existsSync(resolve(fixture.attemptDir, "receipt.json")),
      parkedReceipt: existsSync(resolve(trace.parkedRoot, "receipt.json")),
      currentTemporaries: receiptTemporaryNames(fixture.attemptDir),
      parkedTemporaries: receiptTemporaryNames(trace.parkedRoot),
    }, {
      currentEvidence: false,
      parkedEvidence: false,
      currentReceipt: false,
      parkedReceipt: false,
      currentTemporaries: [],
      parkedTemporaries: [],
    });
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 runner cleanup stays on the held root when its resolved cleanup pathname moves", async () => {
  // Given: only the immutable controller exists before a fresh runner-owned evidence directory name.
  const fixture = createFinalizerFixture();
  try {
    resetFinalizerFixtureForFreshRunner(fixture);
    const controllerBytes = readFileSync(resolve(fixture.attemptDir, "controller-run-context.json"));
    const evidenceDir = resolve(fixture.attemptDir, "new-real-surface");
    const ports = await reserveServicePorts();

    // When: the root moves once after mkdir and again immediately before the real cleanup operation.
    const trace = await withRunnerCleanupRootMove(fixture, evidenceDir, () => runRealSurface({
      runId: fixture.runContext.expectedRunId,
      runContext: fixture.runContext,
      evidenceDir,
      node20Bin: "/Users/jmpark/.nvm/versions/node/v20.20.2/bin/node",
      node22Bin: "/Users/jmpark/.nvm/versions/node/v22.23.0/bin/node",
      ports,
    }));

    // Then: only the runner-created directory is removed through the held fd; the controller is unchanged.
    assert.equal(trace.firstSwap, true);
    assert.equal(trace.cleanupSwap, true);
    assert.equal(trace.result, undefined);
    assert.equal(trace.error?.code, "FINALIZATION_PATH_ANCESTOR_CHANGED");
    assert.deepEqual(Object.keys(trace.helperProtocol.request), ["expectedDev", "expectedIno", "name", "op"]);
    assert.match(trace.helperProtocol.request.expectedDev, /^[1-9][0-9]*$/u);
    assert.match(trace.helperProtocol.request.expectedIno, /^[1-9][0-9]*$/u);
    assert.deepEqual({ ...trace.helperProtocol, request: {
      expectedDev: "<owned-dev>",
      expectedIno: "<owned-ino>",
      name: trace.helperProtocol.request.name,
      op: trace.helperProtocol.request.op,
    } }, {
      heldDescriptorMapped: true,
      inputLeaksAttemptPath: false,
      request: {
        expectedDev: "<owned-dev>",
        expectedIno: "<owned-ino>",
        name: "new-real-surface",
        op: "remove_tree",
      },
      responseLeaksAttemptPath: false,
      shell: false,
      status: 0,
      stderr: "",
    });
    assert.deepEqual({
      currentEvidence: existsSync(resolve(fixture.attemptDir, "new-real-surface")),
      intermediateEvidence: existsSync(resolve(trace.parkedRoot, "new-real-surface")),
      heldEvidence: existsSync(resolve(trace.heldRoot, "new-real-surface")),
    }, {
      currentEvidence: false,
      intermediateEvidence: false,
      heldEvidence: false,
    });
    assert.deepEqual(
      readFileSync(resolve(trace.heldRoot, "controller-run-context.json")),
      controllerBytes,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 descriptor cleanup attempts every stable close and still closes the finalizer root", () => {
  const fixture = createFinalizerFixture();
  const fault = installDescriptorCloseFault(fixture, { allStableDescriptors: true });
  let error;
  try {
    finalizeFixture(fixture);
  } catch (caught) {
    error = caught;
  } finally {
    fault.restore();
  }
  try {
    const trace = fault.trace();
    assert.equal(error?.code, "EIO");
    assert.equal(trace.injected, true);
    assert.ok(trace.stableDescriptors > 2, JSON.stringify(trace));
    assert.equal(trace.attemptedStableCloses, trace.stableDescriptors, JSON.stringify(trace));
    assert.equal(trace.rootCloseAttempted, true, JSON.stringify(trace));
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 runner-context validation closes its held root when descriptor cleanup reports an error", () => {
  const fixture = createFinalizerFixture();
  const fault = installDescriptorCloseFault(fixture);
  let error;
  try {
    validateRunnerRunContext(fixture.attemptDir, fixture.runContext);
  } catch (caught) {
    error = caught;
  } finally {
    fault.restore();
  }
  try {
    const trace = fault.trace();
    assert.equal(error?.code, "EIO");
    assert.equal(trace.injected, true);
    assert.equal(trace.attemptedStableCloses, trace.stableDescriptors, JSON.stringify(trace));
    assert.equal(trace.rootCloseAttempted, true, JSON.stringify(trace));
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 real-surface runner closes its held root when validation descriptor cleanup reports an error", async () => {
  const fixture = createFinalizerFixture();
  resetFinalizerFixtureForFreshRunner(fixture);
  const fault = installDescriptorCloseFault(fixture);
  let error;
  try {
    await runRealSurface({
      runId: fixture.runContext.expectedRunId,
      runContext: fixture.runContext,
      evidenceDir: resolve(fixture.attemptDir, "new-real-surface"),
      node20Bin: "/Users/jmpark/.nvm/versions/node/v20.20.2/bin/node",
      node22Bin: "/Users/jmpark/.nvm/versions/node/v22.23.0/bin/node",
      ports: fixture.manifest.ports,
    });
  } catch (caught) {
    error = caught;
  } finally {
    fault.restore();
  }
  try {
    const trace = fault.trace();
    assert.equal(error?.code, "EIO");
    assert.equal(trace.injected, true);
    assert.equal(trace.attemptedStableCloses, trace.stableDescriptors, JSON.stringify(trace));
    assert.equal(trace.rootCloseAttempted, true, JSON.stringify(trace));
    assert.equal(existsSync(resolve(fixture.attemptDir, "new-real-surface")), false);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer fails closed across the clock-probe I/O fault matrix", () => {
  for (const operation of ["write", "file-fsync", "fstat", "unlink", "dir-fsync", "close"]) {
    const fixture = createFinalizerFixture();
    try {
      let accepted = false;
      let errorCode;
      const trace = withInjectedClockProbeFailure(fixture, operation, () => {
        try {
          finalizeFixture(fixture);
          accepted = true;
        } catch (error) {
          errorCode = error.code;
        }
      });

      assert.deepEqual({
        operation,
        injected: trace.injected,
        accepted,
        errorCode,
        receiptExists: existsSync(resolve(fixture.attemptDir, "receipt.json")),
        probeNames: finalizerClockProbeNames(fixture.attemptDir),
        temporaryNames: receiptTemporaryNames(fixture.attemptDir),
      }, {
        operation,
        injected: true,
        accepted: false,
        errorCode: "FINALIZER_CLOCK_PROBE_FAILED",
        receiptExists: false,
        probeNames: [],
        temporaryNames: [],
      });
    } finally {
      fixture.cleanup();
    }
  }
});

test("Gate37 finalizer rejects a clock-probe pathname swap at unlink", () => {
  const fixture = createFinalizerFixture();
  try {
    let accepted = false;
    let errorCode;
    const trace = withClockProbePathSwapAtUnlink(fixture, () => {
      try {
        finalizeFixture(fixture);
        accepted = true;
      } catch (error) {
        errorCode = error.code;
      }
    });

    assert.deepEqual({
      swapped: trace.swapped,
      accepted,
      errorCode,
      parkedOriginalExists: existsSync(trace.parkedProbe),
      receiptExists: existsSync(resolve(fixture.attemptDir, "receipt.json")),
      probeNames: finalizerClockProbeNames(fixture.attemptDir),
      temporaryNames: receiptTemporaryNames(fixture.attemptDir),
    }, {
      swapped: true,
      accepted: false,
      errorCode: "FINALIZER_CLOCK_PROBE_CHANGED",
      parkedOriginalExists: true,
      receiptExists: false,
      probeNames: [],
      temporaryNames: [],
    });
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer accepts already-created inputs at the filesystem-probe upper boundary", () => {
  const fixture = createFinalizerFixture();
  try {
    const inputPaths = [
      resolve(fixture.attemptDir, "controller-run-context.json"),
      ...fixture.manifest.artifacts.map((artifact) => resolve(fixture.attemptDir, artifact.path)),
      resolve(fixture.attemptDir, "finalization-manifest.json"),
      resolve(fixture.attemptDir, fixture.surfaceDescriptor.report),
      resolve(fixture.attemptDir, `review-handoffs/${fixture.surfaceDescriptor.name}`),
      resolve(fixture.attemptDir, fixture.finalDescriptor.report),
      resolve(fixture.attemptDir, `review-handoffs/${fixture.finalDescriptor.name}`),
    ];
    const probeUpperBoundNs = inputPaths.reduce((upperBound, path) => {
      const metadata = lstatSync(path, { bigint: true });
      return [metadata.mtimeNs, metadata.ctimeNs].reduce(
        (current, value) => value > current ? value : current,
        upperBound,
      );
    }, 0n);

    assert.equal(
      withClockProbeTimestamp(
        fixture.attemptDir,
        probeUpperBoundNs,
        () => finalizeFixture(fixture).result,
      ),
      "PASS",
    );
    assert.deepEqual(finalizerClockProbeNames(fixture.attemptDir), []);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer classifies a same-byte artifact replacement as stale at the filesystem-probe boundary", () => {
  const fixture = createFinalizerFixture();
  try {
    const replacedPath = resolve(fixture.attemptDir, "real-surface/result.json");
    replaceWithSameBytes(replacedPath);
    const inputPaths = [
      resolve(fixture.attemptDir, "controller-run-context.json"),
      ...fixture.manifest.artifacts.map((artifact) => resolve(fixture.attemptDir, artifact.path)),
      resolve(fixture.attemptDir, "finalization-manifest.json"),
      resolve(fixture.attemptDir, fixture.surfaceDescriptor.report),
      resolve(fixture.attemptDir, `review-handoffs/${fixture.surfaceDescriptor.name}`),
      resolve(fixture.attemptDir, fixture.finalDescriptor.report),
      resolve(fixture.attemptDir, `review-handoffs/${fixture.finalDescriptor.name}`),
    ];
    const probeUpperBoundNs = inputPaths.reduce((upperBound, path) => {
      const metadata = lstatSync(path, { bigint: true });
      return [metadata.mtimeNs, metadata.ctimeNs].reduce(
        (current, value) => value > current ? value : current,
        upperBound,
      );
    }, 0n);

    withClockProbeTimestamp(
      fixture.attemptDir,
      probeUpperBoundNs,
      () => assert.throws(
        () => finalizeFixture(fixture),
        (error) => {
          assert.equal(error.code, "FINALIZATION_ARTIFACT_STALE");
          return true;
        },
      ),
    );
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    assert.deepEqual(finalizerClockProbeNames(fixture.attemptDir), []);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer fails closed on a preexisting predictable clock probe", () => {
  const fixture = createFinalizerFixture();
  try {
    const probePath = resolve(fixture.attemptDir, `.u002-finalizer-clock-${process.pid}`);
    writeFileSync(probePath, "preexisting-clock-probe\n", { encoding: "utf8", mode: 0o600 });
    writeFileSync(resolve(fixture.attemptDir, "finalization-manifest.json"), "not-json\n", "utf8");

    assert.throws(
      () => finalizeFixture(fixture),
      (error) => {
        assert.equal(error.code, "FINALIZER_CLOCK_PROBE_ALREADY_EXISTS");
        return true;
      },
    );
    assert.equal(readFileSync(probePath, "utf8"), "preexisting-clock-probe\n");
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer rejects malformed canonical epoch decimals before receipt construction", () => {
  const fixture = createFinalizerFixture();
  try {
    for (const expectedRunStartNs of ["", "0", "01", "+1", "-1", "1.0", "1e3", " 1"] ) {
      assert.throws(
        () => finalizeFixture(fixture, { expectedRunStartNs }),
        /FINAL_RUN_CONTEXT_INVALID/u,
      );
    }
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer CLI requires both expected run-context arguments", () => {
  const fixture = createFinalizerFixture();
  try {
    const script = resolve(repoRoot, "scripts/check-u002-containment-surface.mjs");
    const missing = spawnSync(process.execPath, [
      script,
      "--finalize-receipt",
      "--attempt-dir",
      fixture.attemptDir,
    ], { encoding: "utf8" });
    assert.equal(missing.status, 64);
    assert.match(missing.stderr, /INVALID_FINALIZATION_ARGUMENT/u);

    const malformed = spawnSync(process.execPath, [
      script,
      "--finalize-receipt",
      "--attempt-dir",
      fixture.attemptDir,
      "--expected-run-id",
      fixture.runContext.expectedRunId,
      "--expected-run-start-ns",
      "01",
    ], { encoding: "utf8" });
    assert.equal(malformed.status, 68);
    assert.match(malformed.stderr, /FINAL_RUN_CONTEXT_INVALID/u);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    fixture.cleanup();
  }
});

function spawnRunnerCli(extraArgs) {
  const evidenceDir = mkdtempSync(resolve(tmpdir(), "u002-runner-cli-"));
  try {
    return spawnSync(process.execPath, [
      resolve(repoRoot, "scripts/check-u002-containment-surface.mjs"),
      "--real-surface",
      "--run-id", "run-cli-exact",
      "--expected-run-start-ns", "1",
      "--evidence-dir", evidenceDir,
      "--node20-bin", process.execPath,
      "--node22-bin", process.execPath,
      "--web-port", "43101",
      "--api-port", "43102",
      "--workflow-operator-port", "43103",
      "--engineer-bridge-port", "43104",
      "--engineer-operator-port", "43105",
      ...extraArgs,
    ], { encoding: "utf8" });
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
}

function createGate38RunnerFixture(priorRunIds = []) {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-gate38-runner-"));
  const attemptDir = resolve(fixtureRoot, "U002/attempt-6");
  mkdirSync(attemptDir, { recursive: true });
  const runContext = {
    expectedRunId: "u002-attempt6-fixture",
    expectedRunStartNs: (BigInt(Date.now() - 1_000) * 1_000_000n).toString(),
  };
  const controllerPath = resolve(attemptDir, "controller-run-context.json");
  writeCanonicalJson(controllerPath, {
    schemaVersion: 1,
    unit: "U002",
    runContext,
    priorRunIds,
  });
  chmodSync(controllerPath, 0o600);
  return {
    fixtureRoot,
    attemptDir,
    runContext,
    cleanup() {
      rmSync(fixtureRoot, { recursive: true, force: true });
    },
  };
}

function gate38RunnerConfig(fixture, overrides = {}) {
  return {
    runId: fixture.runContext.expectedRunId,
    runContext: fixture.runContext,
    evidenceDir: resolve(fixture.attemptDir, "real-surface"),
    node20Bin: "/Users/jmpark/.nvm/versions/node/v20.20.2/bin/node",
    node22Bin: "/Users/jmpark/.nvm/versions/node/v22.23.0/bin/node",
    ports: {
      web: 45101,
      api: 45102,
      "workflow-operator": 45103,
      "engineer-bridge": 45104,
      "engineer-operator": 45105,
    },
    ...overrides,
  };
}

function installAfterPreflightCollision(targetPath) {
  const originalWriteFileSync = mutableFs.writeFileSync;
  const originalOpenSync = mutableFs.openSync;
  const originalSpawnSync = mutableChildProcess.spawnSync;
  const sentinel = Buffer.from("same-path-created-after-preflight\n");
  let injected = false;
  let overwriteObserved = false;
  const inject = () => {
    if (injected) return;
    injected = true;
    originalWriteFileSync.call(mutableFs, targetPath, sentinel, { flag: "wx", mode: 0o600 });
  };
  mutableFs.writeFileSync = function injectBeforePathWrite(path, ...args) {
    if (!injected && typeof path === "string" && resolve(path) === resolve(targetPath)) {
      inject();
      const result = originalWriteFileSync.call(mutableFs, path, ...args);
      overwriteObserved = !readFileSync(targetPath).equals(sentinel);
      const error = new Error("INJECTED_POST_PREFLIGHT_OVERWRITE");
      error.code = "INJECTED_POST_PREFLIGHT_OVERWRITE";
      throw error;
    }
    return originalWriteFileSync.call(mutableFs, path, ...args);
  };
  mutableFs.openSync = function injectBeforePathOpen(path, ...args) {
    if (!injected && typeof path === "string" && resolve(path) === resolve(targetPath)) inject();
    return originalOpenSync.call(mutableFs, path, ...args);
  };
  mutableChildProcess.spawnSync = function injectBeforeHeldWrite(executable, args, options) {
    if (!injected && executable === "/usr/bin/python3" && typeof options?.input === "string") {
      const request = JSON.parse(options.input);
      if (request.op === "write" && request.name === basename(targetPath)) inject();
    }
    return originalSpawnSync.call(mutableChildProcess, executable, args, options);
  };
  syncBuiltinESMExports();
  return {
    sentinel,
    trace: () => ({ injected, overwriteObserved }),
    restore() {
      mutableFs.writeFileSync = originalWriteFileSync;
      mutableFs.openSync = originalOpenSync;
      mutableChildProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
    },
  };
}

function installRunnerTmpdirRemovalRace() {
  const originalRmSync = mutableFs.rmSync;
  const originalSpawnSync = mutableChildProcess.spawnSync;
  const sentinel = Buffer.from("replacement-during-tmpdir-removal\n");
  let targetPath;
  let parkedPath;
  let sentinelPath;
  let injected = false;
  let trigger;
  const inject = (nextTrigger) => {
    if (injected || !targetPath) return;
    injected = true;
    trigger = nextTrigger;
    parkedPath = `${targetPath}.parked-during-remove`;
    sentinelPath = resolve(targetPath, "replacement-owner.txt");
    renameSync(targetPath, parkedPath);
    mkdirSync(targetPath, { mode: 0o700 });
    writeFileSync(sentinelPath, sentinel, { flag: "wx", mode: 0o600 });
  };
  mutableFs.rmSync = function injectBeforePathRemoval(path, ...args) {
    if (targetPath && typeof path === "string" && resolve(path) === resolve(targetPath)) inject("rmSync");
    return originalRmSync.call(mutableFs, path, ...args);
  };
  mutableChildProcess.spawnSync = function injectBeforeDescriptorRemoval(executable, args, options) {
    if (
      targetPath
      && executable === "/usr/bin/python3"
      && parseDirFdOperation(options) === "remove_tree"
    ) {
      const request = JSON.parse(String(options.input));
      if (request.name === basename(targetPath)) inject("remove_tree");
    }
    return originalSpawnSync.call(mutableChildProcess, executable, args, options);
  };
  syncBuiltinESMExports();
  return {
    arm(path) {
      targetPath = path;
    },
    sentinel,
    trace: () => ({ injected, parkedPath, sentinelPath, targetPath, trigger }),
    restore() {
      mutableFs.rmSync = originalRmSync;
      mutableChildProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
    },
  };
}

function installSetupAcquisitionFault(variant, evidenceDir) {
  let injected = false;
  let runnerTmpdir;
  return {
    hook(acquisition, state) {
      assert.equal(resolve(state.evidenceDir), resolve(evidenceDir));
      runnerTmpdir = state.runnerTmpdir?.logicalPath;
      if (!injected && acquisition === variant) {
        injected = true;
        const error = new Error(`INJECTED_SETUP_${variant.toUpperCase()}`);
        error.code = `INJECTED_SETUP_${variant.toUpperCase()}`;
        throw error;
      }
    },
    trace: () => ({ injected, runnerTmpdir }),
    restore() {},
  };
}

async function runEarlySetupSignal(signal, { cleanupFails = false } = {}) {
  const fixture = createGate38RunnerFixture([]);
  const configuration = gate38RunnerConfig(fixture, { ports: await reserveServicePorts() });
  const cleanupMarker = resolve(fixture.fixtureRoot, `cleanup-${signal}-${cleanupFails ? "fail" : "pass"}.log`);
  const moduleUrl = pathToFileURL(resolve(repoRoot, "scripts/check-u002-containment-surface.mjs")).href;
  const program = `
import { createRequire } from "node:module";
const fs = createRequire(import.meta.url)("node:fs");
const { runRealSurface } = await import(${JSON.stringify(moduleUrl)});
const configuration = ${JSON.stringify(configuration)};
const originalExit = process.exit.bind(process);
process.exit = (code) => {
  fs.writeFileSync(
    ${JSON.stringify(cleanupMarker)},
    "exit:" + code + ":sigint=" + process.listenerCount("SIGINT") + ":sigterm=" + process.listenerCount("SIGTERM") + "\\n",
    { flag: "a" },
  );
  originalExit(code);
};
configuration.hooks = {
  afterSetupAcquisition: async (acquisition, state) => {
    if (acquisition !== "realpath") return;
    await new Promise((resolveYield) => setImmediate(resolveYield));
    await new Promise((resolveSend, rejectSend) => process.send({
      type: "armed",
      runnerTmpdir: state.runnerTmpdir.logicalPath,
      sigintListeners: process.listenerCount("SIGINT"),
      sigtermListeners: process.listenerCount("SIGTERM"),
    }, (error) => error ? rejectSend(error) : resolveSend()));
    await new Promise((resolveRelease) => process.once("message", (message) => {
      if (message?.type === "release") resolveRelease();
    }));
  },
  onCleanupSettled: (cleanup) => {
    fs.writeFileSync(
      ${JSON.stringify(cleanupMarker)},
      "settled:" + JSON.stringify({ result: cleanup?.result, totals: cleanup?.totals }) + "\\n",
      { flag: "a" },
    );
    if (${JSON.stringify(cleanupFails)}) {
      const error = new Error("INJECTED_EARLY_SIGNAL_CLEANUP_FAILURE");
      error.code = "INJECTED_EARLY_SIGNAL_CLEANUP_FAILURE";
      throw error;
    }
  },
};
try {
  await runRealSurface(configuration);
} catch (error) {
  process.stderr.write(String(error.code ?? error.message) + "\\n");
  process.exitCode = error.exitCode ?? 1;
}
`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  return new Promise((resolveTrace, rejectTrace) => {
    let stdout = "";
    let stderr = "";
    let signalSent = false;
    let runnerTmpdir;
    const armedMessages = [];
    const watchdog = setTimeout(() => {
      child.kill("SIGKILL");
      rejectTrace(new Error(`Gate38 ${signal} IPC arm watchdog expired`));
    }, 10_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("message", (message) => {
      armedMessages.push(message);
      if (
        message?.type !== "armed"
        || typeof message.runnerTmpdir !== "string"
        || message.sigintListeners !== 1
        || message.sigtermListeners !== 1
        || signalSent
      ) {
        child.kill("SIGKILL");
        rejectTrace(new Error(`Gate38 ${signal} invalid IPC arm: ${JSON.stringify(message)}`));
        return;
      }
      runnerTmpdir = message.runnerTmpdir;
      signalSent = child.kill(signal);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectTrace);
    child.once("close", (code, terminationSignal) => {
      clearTimeout(watchdog);
      resolveTrace({
        fixture,
        cleanupMarker,
        code,
        terminationSignal,
        stdout,
        stderr,
        signalSent,
        runnerTmpdir,
        armedMessages,
      });
    });
  });
}

function writePriorSnapshot(fixture, attempt, runId) {
  writeCanonicalJson(
    resolve(fixture.fixtureRoot, `U002/attempt-${attempt}/dispatcher/snapshot.json`),
    { schemaVersion: 1, unit: "U002", attempt, runId },
  );
}

function assertInvalidRunnerCli(result) {
  assert.equal(result.status, 64);
  assert.equal(result.stderr.split(/\r?\n/u)[0], "INVALID_REAL_SURFACE_ARGUMENT");
}

test("Gate37 runner CLI rejects an unknown flag before controller validation", () => {
  const result = spawnRunnerCli(["--unexpected-flag", "accepted"]);
  assertInvalidRunnerCli(result);
});

test("Gate37 runner CLI rejects a duplicate approved flag", () => {
  const result = spawnRunnerCli(["--run-id", "duplicate-run"]);
  assertInvalidRunnerCli(result);
});

test("Gate37 runner CLI rejects a valueless flag", () => {
  const result = spawnRunnerCli(["--unexpected-flag"]);
  assertInvalidRunnerCli(result);
});

test("Gate37 runner CLI rejects extra positional arguments", () => {
  const result = spawnRunnerCli(["extra-positional", "accepted"]);
  assertInvalidRunnerCli(result);
});

test("Gate37 runner requires canonical run context and matches the controller without creating it", () => {
  const fixture = createFinalizerFixture();
  try {
    const controllerPath = resolve(fixture.attemptDir, "controller-run-context.json");
    const before = readFileSync(controllerPath);
    const beforeMetadata = lstatSync(controllerPath, { bigint: true });
    assert.deepEqual(
      validateRunnerRunContext(fixture.attemptDir, fixture.runContext),
      { runContext: fixture.runContext, priorRunIds: [] },
    );
    assert.throws(
      () => validateRunnerRunContext(fixture.attemptDir, {
        ...fixture.runContext,
        expectedRunId: "different-runner-id",
      }),
      /FINAL_RUN_CONTEXT_MISMATCH/u,
    );
    assert.throws(
      () => validateRunnerRunContext(fixture.attemptDir, {
        ...fixture.runContext,
        expectedRunStartNs: "01",
      }),
      /FINAL_RUN_CONTEXT_INVALID/u,
    );
    assert.deepEqual(readFileSync(controllerPath), before);
    const afterMetadata = lstatSync(controllerPath, { bigint: true });
    assert.equal(afterMetadata.dev, beforeMetadata.dev);
    assert.equal(afterMetadata.ino, beforeMetadata.ino);
  } finally {
    fixture.cleanup();
  }
});

test("Gate38 runner derives the exact sorted prior run set from snapshots and lifecycle evidence", () => {
  // Given: four dispatcher snapshots plus the failed attempt-5 controller and corroborating attempt-1 receipt.
  const expectedPriorRunIds = [
    "09821E4E-ECC4-410E-A8FA-DB8B290C0000",
    "7572F805-1964-4671-ADD7-79774C8C2893",
    "8D56404A-D4CC-4A33-AEC5-8EF9B8F163F8",
    "9D7F41A4-C191-49DF-BF9C-BBE7B0B6273B",
    "u002-attempt5-4e9949aa-21ff-4b19-8485-49e682e5738f",
  ];
  const fixture = createGate38RunnerFixture(expectedPriorRunIds);
  try {
    writePriorSnapshot(fixture, 1, expectedPriorRunIds[1]);
    writeCanonicalJson(resolve(fixture.fixtureRoot, "U002/attempt-1/receipt.json"), {
      runId: expectedPriorRunIds[1],
    });
    writePriorSnapshot(fixture, 2, expectedPriorRunIds[2]);
    writePriorSnapshot(fixture, 3, expectedPriorRunIds[3]);
    writePriorSnapshot(fixture, 4, expectedPriorRunIds[0]);
    const attempt5Controller = resolve(
      fixture.fixtureRoot,
      "U002/attempt-5/controller-run-context.json",
    );
    writeCanonicalJson(attempt5Controller, {
      schemaVersion: 1,
      unit: "U002",
      runContext: {
        expectedRunId: expectedPriorRunIds[4],
        expectedRunStartNs: "1",
      },
      priorRunIds: [expectedPriorRunIds[1]],
    });
    chmodSync(attempt5Controller, 0o600);

    // When: the runner validates the attempt-6 controller against independently derived history.
    const result = validateRunnerRunContext(fixture.attemptDir, fixture.runContext);

    // Then: every historical run ID is present exactly once in bytewise order.
    assert.deepEqual(result, { runContext: fixture.runContext, priorRunIds: expectedPriorRunIds });
  } finally {
    fixture.cleanup();
  }
});

test("Gate38 prior-run derivation rejects conflicting and duplicate attempt identities", () => {
  for (const variant of ["conflict", "duplicate"]) {
    // Given: independently stored lifecycle evidence that cannot identify one unique run per attempt.
    const runIds = variant === "conflict" ? ["run-a", "run-b"] : ["run-a"];
    const fixture = createGate38RunnerFixture(runIds);
    try {
      if (variant === "conflict") {
        writeCanonicalJson(resolve(fixture.fixtureRoot, "U002/attempt-4/finalization-manifest.json"), {
          runId: "run-a",
        });
        writeCanonicalJson(resolve(fixture.fixtureRoot, "U002/attempt-4/receipt.json"), {
          runId: "run-b",
        });
      } else {
        writeCanonicalJson(resolve(fixture.fixtureRoot, "U002/attempt-3/finalization-manifest.json"), {
          runId: "run-a",
        });
        writeCanonicalJson(resolve(fixture.fixtureRoot, "U002/attempt-4/receipt.json"), {
          runId: "run-a",
        });
      }

      // When/Then: conflicts and cross-attempt duplicates fail closed rather than Set-deduplicating.
      assert.throws(
        () => validateRunnerRunContext(fixture.attemptDir, fixture.runContext),
        /FINAL_PRIOR_RUN_EVIDENCE_INVALID/u,
        variant,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("Gate38 prior-run derivation rejects malformed and symlinked dispatcher snapshots", () => {
  for (const variant of ["malformed", "symlink"]) {
    // Given: a prior attempt exposes a dispatcher snapshot that is not trusted canonical evidence.
    const fixture = createGate38RunnerFixture([]);
    const snapshotPath = resolve(fixture.fixtureRoot, "U002/attempt-4/dispatcher/snapshot.json");
    mkdirSync(dirname(snapshotPath), { recursive: true });
    try {
      if (variant === "malformed") {
        writeFileSync(snapshotPath, "not-json\n", "utf8");
      } else {
        const outside = resolve(fixture.fixtureRoot, "outside-snapshot.json");
        writeCanonicalJson(outside, { schemaVersion: 1, unit: "U002", attempt: 4, runId: "run-a" });
        symlinkSync(outside, snapshotPath);
      }

      // When/Then: the runner rejects the unsafe history before accepting attempt-6.
      assert.throws(
        () => validateRunnerRunContext(fixture.attemptDir, fixture.runContext),
        /FINAL_PRIOR_RUN_EVIDENCE_INVALID|FINALIZATION_ARTIFACT_NOT_REGULAR/u,
        variant,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("Gate38 runner collision preflight wins before Node validation or lifecycle mutation", async () => {
  const collisionPaths = [
    "readiness-workflow-focused.log",
    "focused-evidence-index.json",
    "source-integrity-before.json",
    "surface-qa.md",
    "finalization-manifest.json",
    "review-handoffs/surface-qa.json",
    "receipt.json",
    "real-surface/logs/web.stdout.log",
    "dispatcher/snapshot.json",
  ];
  for (const collisionPath of collisionPaths) {
    // Given: one phase-one, finalization, or forbidden control output already exists in attempt-6.
    const fixture = createGate38RunnerFixture([]);
    const absoluteCollision = resolve(fixture.attemptDir, collisionPath);
    mkdirSync(dirname(absoluteCollision), { recursive: true });
    writeFileSync(absoluteCollision, "collision\n", "utf8");
    const beforeEntries = readdirSync(fixture.attemptDir).sort();
    try {
      // When: invalid Node paths make any command-before-preflight ordering observable.
      await assert.rejects(
        runRealSurface({
          runId: fixture.runContext.expectedRunId,
          runContext: fixture.runContext,
          evidenceDir: resolve(fixture.attemptDir, "real-surface"),
          node20Bin: "/invalid-node20-must-not-be-read",
          node22Bin: "/invalid-node22-must-not-be-read",
          ports: {
            web: 45101,
            api: 45102,
            "workflow-operator": 45103,
            "engineer-bridge": 45104,
            "engineer-operator": 45105,
          },
        }),
        (error) => {
          assert.equal(error.code, "RUNNER_OUTPUT_COLLISION", collisionPath);
          assert.match(error.message, new RegExp(collisionPath.replaceAll("/", "\\/"), "u"));
          return true;
        },
      );

      // Then: no tmp/runtime/finalization work is added and no receipt can exist.
      assert.deepEqual(readdirSync(fixture.attemptDir).sort(), beforeEntries, collisionPath);
      assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), collisionPath === "finalization-manifest.json");
      assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), collisionPath === "receipt.json");
    } finally {
      fixture.cleanup();
    }
  }
});

test("Gate38 runner preserves a runner-tmpdir sentinel created after preflight", async () => {
  // Given: the runner passed freshness checks before another owner creates its first JSON path.
  const fixture = createGate38RunnerFixture([]);
  const targetPath = resolve(fixture.attemptDir, "real-surface/runner-tmpdir.json");
  const collision = installAfterPreflightCollision(targetPath);
  let runnerTmpdir;
  try {
    // When: the actual runner reaches the first immutable evidence write.
    await assert.rejects(
      runRealSurface(gate38RunnerConfig(fixture, {
        ports: await reserveServicePorts(),
        hooks: {
          afterSetupAcquisition: (_acquisition, state) => {
            runnerTmpdir = state.runnerTmpdir?.logicalPath ?? runnerTmpdir;
          },
        },
      })),
      (error) => error?.code === "RUNNER_OUTPUT_COLLISION",
    );

    // Then: the other owner's bytes survive and finalization never begins.
    assert.equal(collision.trace().injected, true);
    assert.equal(collision.trace().overwriteObserved, false);
    assert.deepEqual(readFileSync(targetPath), collision.sentinel);
    assert.deepEqual(readdirSync(dirname(targetPath)), ["runner-tmpdir.json"]);
    assert.equal(existsSync(runnerTmpdir), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    collision.restore();
    fixture.cleanup();
  }
});

test("Gate38 runner refuses a replaced tmpdir pathname without deleting the replacement", async () => {
  // Given: another owner renames the run-owned tmpdir and installs a sentinel directory at its pathname.
  const fixture = createGate38RunnerFixture([]);
  const evidenceDir = resolve(fixture.attemptDir, "real-surface");
  const sentinel = Buffer.from("replacement-tmpdir-owner\n");
  let runnerTmpdir;
  let parkedTmpdir;
  let sentinelPath;
  let cleanupResult;
  let cleanupSettlements = 0;
  let observedError;
  const beforeSigint = process.listenerCount("SIGINT");
  const beforeSigterm = process.listenerCount("SIGTERM");
  try {
    // When: cleanup runs after the pathname takeover is observed at a real setup hook.
    try {
      await runRealSurface(gate38RunnerConfig(fixture, {
        ports: await reserveServicePorts(),
        hooks: {
          afterSetupAcquisition: (acquisition, state) => {
            if (acquisition !== "realpath") return;
            runnerTmpdir = state.runnerTmpdir.logicalPath;
            parkedTmpdir = `${runnerTmpdir}.parked`;
            sentinelPath = resolve(runnerTmpdir, "replacement-owner.txt");
            renameSync(runnerTmpdir, parkedTmpdir);
            mkdirSync(runnerTmpdir, { mode: 0o700 });
            writeFileSync(sentinelPath, sentinel, { flag: "wx", mode: 0o600 });
            const error = new Error("tmpdir pathname replaced after acquisition");
            error.code = "INJECTED_TMPDIR_PATH_REPLACEMENT";
            throw error;
          },
          onCleanupSettled: (result) => {
            cleanupSettlements += 1;
            cleanupResult = result;
          },
        },
      }));
    } catch (error) {
      observedError = error;
    }

    // Then: cleanup fails closed, retains both identities, and reports the primary and cleanup causes.
    assert.equal(existsSync(sentinelPath), true, "cleanup deleted the replacement tmpdir sentinel");
    assert.deepEqual(readFileSync(sentinelPath), sentinel);
    assert.equal(existsSync(parkedTmpdir), true, "cleanup lost the originally owned tmpdir");
    assert.equal(observedError?.code, "REAL_SURFACE_CLEANUP_FAILED");
    assert.equal(observedError?.exitCode, 68);
    assert.equal(observedError?.cause?.code, "INJECTED_TMPDIR_PATH_REPLACEMENT");
    assert.match(observedError?.message ?? "", /RUNNER_TMPDIR_IDENTITY_CHANGED/u);
    assert.equal(cleanupSettlements, 1);
    assert.equal(cleanupResult?.result, "FAIL");
    assert.equal(cleanupResult?.runnerTmpdir?.logicalAbsent, false);
    assert.equal(cleanupResult?.runnerTmpdir?.realAbsent, false);
    assert.equal(cleanupResult?.runnerTmpdir?.error?.code, "RUNNER_TMPDIR_IDENTITY_CHANGED");
    assert.equal(existsSync(evidenceDir), false);
    assert.equal(process.listenerCount("SIGINT"), beforeSigint);
    assert.equal(process.listenerCount("SIGTERM"), beforeSigterm);
    assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    if (runnerTmpdir && existsSync(runnerTmpdir)) rmSync(runnerTmpdir, { recursive: true, force: true });
    if (parkedTmpdir && existsSync(parkedTmpdir)) rmSync(parkedTmpdir, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("Gate38 descriptor cleanup refuses a tmpdir replacement injected after its identity precheck", async () => {
  // Given: the pathname is still owned when cleanup checks it, then changes at the deletion operation.
  const fixture = createGate38RunnerFixture([]);
  const evidenceDir = resolve(fixture.attemptDir, "real-surface");
  const race = installRunnerTmpdirRemovalRace();
  let cleanupResult;
  let observedError;
  try {
    // When: the real descriptor remover is intercepted immediately before it opens the child name.
    try {
      await runRealSurface(gate38RunnerConfig(fixture, {
        ports: await reserveServicePorts(),
        hooks: {
          afterSetupAcquisition: (acquisition, state) => {
            if (acquisition !== "realpath") return;
            race.arm(state.runnerTmpdir.logicalPath);
            const error = new Error("enter cleanup after arming tmpdir removal race");
            error.code = "INJECTED_TMPDIR_REMOVAL_RACE";
            throw error;
          },
          onCleanupSettled: (result) => {
            cleanupResult = result;
          },
        },
      }));
    } catch (error) {
      observedError = error;
    }

    // Then: expected identity travels into the removal operation and neither directory is deleted.
    const trace = race.trace();
    assert.equal(trace.injected, true);
    assert.equal(trace.trigger, "remove_tree");
    assert.equal(existsSync(trace.sentinelPath), true, "descriptor cleanup deleted the replacement");
    assert.deepEqual(readFileSync(trace.sentinelPath), race.sentinel);
    assert.equal(existsSync(trace.parkedPath), true, "descriptor cleanup deleted the owned inode after rename");
    assert.equal(observedError?.code, "REAL_SURFACE_CLEANUP_FAILED");
    assert.equal(observedError?.exitCode, 68);
    assert.equal(observedError?.cause?.code, "INJECTED_TMPDIR_REMOVAL_RACE");
    assert.match(observedError?.message ?? "", /RUNNER_TMPDIR_IDENTITY_CHANGED/u);
    assert.equal(cleanupResult?.result, "FAIL");
    assert.equal(cleanupResult?.runnerTmpdir?.error?.code, "RUNNER_TMPDIR_IDENTITY_CHANGED");
    assert.equal(existsSync(evidenceDir), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    const trace = race.trace();
    race.restore();
    if (trace.targetPath && existsSync(trace.targetPath)) rmSync(trace.targetPath, { recursive: true, force: true });
    if (trace.parkedPath && existsSync(trace.parkedPath)) rmSync(trace.parkedPath, { recursive: true, force: true });
    fixture.cleanup();
  }
});

for (const setupVariant of ["mkdir", "mkdtemp", "chmod", "realpath"]) {
  test(`Gate38 setup fault after ${setupVariant} cleans acquired resources exactly once`, async () => {
    // Given: a fault occurs immediately after one concrete setup acquisition.
    const fixture = createGate38RunnerFixture([]);
    const evidenceDir = resolve(fixture.attemptDir, "real-surface");
    const fault = installSetupAcquisitionFault(setupVariant, evidenceDir);
    let cleanupSettlements = 0;
    let cleanupResult;
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const controllerPath = resolve(fixture.attemptDir, "controller-run-context.json");
    const controllerBytes = readFileSync(controllerPath);
    try {
      // When: the actual runner executes setup with the injected filesystem fault.
      await assert.rejects(
        runRealSurface(gate38RunnerConfig(fixture, {
          ports: await reserveServicePorts(),
          hooks: {
            afterSetupAcquisition: fault.hook,
            onCleanupSettled: (result) => {
              cleanupSettlements += 1;
              cleanupResult = result;
            },
          },
        })),
        (error) => error?.code === `INJECTED_SETUP_${setupVariant.toUpperCase()}`,
      );

      // Then: only acquired run-owned resources are gone and listeners settle once.
      const trace = fault.trace();
      assert.equal(trace.injected, true);
      assert.equal(existsSync(evidenceDir), false);
      if (trace.runnerTmpdir) assert.equal(existsSync(trace.runnerTmpdir), false);
      assert.equal(cleanupSettlements, 1);
      assert.deepEqual(cleanupResult?.totals, {
        processes: 0,
        listeners: 0,
        portOwners: 0,
        rebindPass: 5,
      });
      assert.equal(cleanupResult?.result, "PASS");
      assert.deepEqual(
        Object.values(cleanupResult?.services ?? {}).map((service) => ({
          state: service.state,
          rebind: service.rebind,
        })),
        Array.from({ length: 5 }, () => ({ state: "NOT_STARTED", rebind: "PASS" })),
      );
      assert.equal(process.listenerCount("SIGINT"), beforeSigint);
      assert.equal(process.listenerCount("SIGTERM"), beforeSigterm);
      assert.deepEqual(readFileSync(controllerPath), controllerBytes);
      assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
      assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    } finally {
      const trace = fault.trace();
      fault.restore();
      if (trace.runnerTmpdir && existsSync(trace.runnerTmpdir)) {
        rmSync(trace.runnerTmpdir, { recursive: true, force: true });
      }
      fixture.cleanup();
    }
  });
}

test("Gate38 setup fault retains primary and cleanup causes when managed cleanup rejects", async () => {
  // Given: a real setup fault occurs and the managed cleanup hook independently rejects.
  const fixture = createGate38RunnerFixture([]);
  const evidenceDir = resolve(fixture.attemptDir, "real-surface");
  const fault = installSetupAcquisitionFault("realpath", evidenceDir);
  const cleanupError = Object.assign(new Error("managed cleanup rejected"), {
    code: "INJECTED_SETUP_CLEANUP_FAILURE",
  });
  let cleanupResult;
  let cleanupSettlements = 0;
  const beforeSigint = process.listenerCount("SIGINT");
  const beforeSigterm = process.listenerCount("SIGTERM");
  const controllerPath = resolve(fixture.attemptDir, "controller-run-context.json");
  const controllerBytes = readFileSync(controllerPath);
  try {
    // When: the actual runner settles both failures through its one cleanup controller.
    await assert.rejects(
      runRealSurface(gate38RunnerConfig(fixture, {
        ports: await reserveServicePorts(),
        hooks: {
          afterSetupAcquisition: fault.hook,
          onCleanupSettled: (result) => {
            cleanupSettlements += 1;
            cleanupResult = result;
            throw cleanupError;
          },
        },
      })),
      (error) => {
        assert.equal(error?.code, "REAL_SURFACE_CLEANUP_FAILED");
        assert.equal(error?.exitCode, 68);
        assert.equal(error?.cause?.code, "INJECTED_SETUP_REALPATH");
        assert.equal(error?.cleanupCause, cleanupError);
        assert.match(error.message, /INJECTED_SETUP_REALPATH/u);
        assert.match(error.message, /INJECTED_SETUP_CLEANUP_FAILURE/u);
        return true;
      },
    );

    // Then: cleanup evidence, resource state, listeners, and controller ownership all remain exact.
    assert.equal(cleanupSettlements, 1);
    assert.equal(cleanupResult?.result, "PASS");
    assert.deepEqual(cleanupResult?.totals, {
      processes: 0,
      listeners: 0,
      portOwners: 0,
      rebindPass: 5,
    });
    assert.equal(existsSync(evidenceDir), false);
    const trace = fault.trace();
    assert.equal(existsSync(trace.runnerTmpdir), false);
    assert.equal(process.listenerCount("SIGINT"), beforeSigint);
    assert.equal(process.listenerCount("SIGTERM"), beforeSigterm);
    assert.deepEqual(readFileSync(controllerPath), controllerBytes);
    assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    const trace = fault.trace();
    fault.restore();
    if (trace.runnerTmpdir && existsSync(trace.runnerTmpdir)) {
      rmSync(trace.runnerTmpdir, { recursive: true, force: true });
    }
    fixture.cleanup();
  }
});

test("Gate38 process journal collision after preflight preserves the replacement bytes", async () => {
  // Given: the output set was fresh before another owner claims processes.json.
  const fixture = createGate38RunnerFixture([]);
  const evidenceDir = resolve(fixture.attemptDir, "real-surface");
  assertRunnerOutputPathsFresh(fixture.attemptDir);
  mkdirSync(resolve(evidenceDir, "logs"), { recursive: true });
  const childDirectory = resolve(evidenceDir, "child");
  mkdirSync(childDirectory);
  const targetPath = resolve(evidenceDir, "processes.json");
  const collision = installAfterPreflightCollision(targetPath);
  const port = await reservePort();
  const ownership = {
    logsDir: resolve(evidenceDir, "logs"),
    processRecordsPath: targetPath,
    publicRecords: [],
    ownedRecords: [],
  };
  try {
    // When: the real detached-service ownership path writes its first process row.
    await assert.rejects(
      spawnService({
        name: "failure-injection",
        node: process.execPath,
        argv: ["-e", `const net=require('node:net');net.createServer().listen(${port},'127.0.0.1');setInterval(()=>{},1000)`],
        cwd: childDirectory,
        env: { ...process.env },
        port,
      }, ownership),
      (error) => error?.code === "RUNNER_OUTPUT_COLLISION",
    );

    // Then: the replacement is never truncated and finalization stays absent.
    assert.deepEqual(readFileSync(targetPath), collision.sentinel);
    assert.equal(collision.trace().overwriteObserved, false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    collision.restore();
    for (const record of ownership.ownedRecords) await cleanupOne(record);
    fixture.cleanup();
  }
});

test("Gate38 result collision after preflight preserves the replacement bytes", () => {
  // Given: the output set was fresh before another owner claims result.json.
  const fixture = createGate38RunnerFixture([]);
  const evidenceDir = resolve(fixture.attemptDir, "real-surface");
  assertRunnerOutputPathsFresh(fixture.attemptDir);
  mkdirSync(evidenceDir);
  const targetPath = resolve(evidenceDir, "result.json");
  const collision = installAfterPreflightCollision(targetPath);
  try {
    // When: the actual immutable result writer reaches the post-preflight pathname.
    assert.throws(
      () => writeFreshJson(targetPath, { schemaVersion: 1, result: "PASS" }),
      (error) => error?.code === "RUNNER_OUTPUT_COLLISION",
    );

    // Then: the replacement survives and no finalization state is created.
    assert.equal(collision.trace().injected, true);
    assert.equal(collision.trace().overwriteObserved, false);
    assert.deepEqual(readFileSync(targetPath), collision.sentinel);
    assert.deepEqual(readdirSync(evidenceDir), ["result.json"]);
    assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    collision.restore();
    fixture.cleanup();
  }
});

test("Gate38 cleanup collision after preflight preserves the replacement bytes", async () => {
  // Given: cleanup.json is claimed after runner preflight but before cleanup settlement.
  const fixture = createGate38RunnerFixture([]);
  const evidenceDir = resolve(fixture.attemptDir, "real-surface");
  assertRunnerOutputPathsFresh(fixture.attemptDir);
  mkdirSync(evidenceDir);
  const targetPath = resolve(evidenceDir, "cleanup.json");
  const logicalTmpdir = mkdtempSync(resolve(tmpdir(), "u002-gate38-cleanup-collision-"));
  const runnerTmpdir = captureRunnerTmpdirOwnership({
    logicalPath: logicalTmpdir,
    realPath: realpathSync(logicalTmpdir),
    mode: "0700",
  });
  const collision = installAfterPreflightCollision(targetPath);
  try {
    // When: the actual cleanup finalizer reaches its immutable receipt write.
    await assert.rejects(
      finalizeCleanup([], targetPath, runnerTmpdir, undefined, await reserveServicePorts()),
      (error) => error?.code === "RUNNER_OUTPUT_COLLISION",
    );

    // Then: cleanup cannot overwrite the other owner or create finalization state.
    assert.deepEqual(readFileSync(targetPath), collision.sentinel);
    assert.equal(collision.trace().overwriteObserved, false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "finalization-manifest.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    collision.restore();
    if (existsSync(logicalTmpdir)) rmSync(logicalTmpdir, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("Gate38 phase-one root collision maps to the runner collision code without replacing bytes", () => {
  // Given: finalization inputs were fresh before another owner claimed the root manifest path.
  const fixture = createFinalizerFixture();
  for (const path of [
    "review-handoffs/surface-qa.json",
    "review-handoffs/final-code.json",
    "surface-qa-review.md",
    "final-code-review.md",
    "finalization-manifest.json",
  ]) unlinkSync(resolve(fixture.attemptDir, path));
  assertRunnerFinalizationInputsFresh(fixture.attemptDir);
  const targetPath = resolve(fixture.attemptDir, "finalization-manifest.json");
  const collision = installAfterPreflightCollision(targetPath);
  try {
    // When: phase-one creation reaches the exclusive root write.
    assert.throws(
      () => writePhaseOneFinalizationManifest({
        attemptDir: fixture.attemptDir,
        config: { runId: fixture.manifest.runId, runContext: fixture.runContext, ports: fixture.manifest.ports },
        artifacts: fixture.manifest.artifacts,
        sourceIntegrity: fixture.sourceIntegrity,
        focusedEvidence: {
          suites: { workflow: { testCount: 1 }, engineer: { testCount: 1 }, business: { testCount: 1 } },
          pptx: { sourceAbsent: true },
        },
      }),
      (error) => error?.code === "RUNNER_OUTPUT_COLLISION",
    );

    // Then: only the sentinel remains and no receipt exists.
    assert.deepEqual(readFileSync(targetPath), collision.sentinel);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    collision.restore();
    fixture.cleanup();
  }
});

test("Gate38 mutable process journal rejects path replacement without touching the replacement", () => {
  // Given: a journal owns its original inode before another owner replaces the pathname.
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-gate38-process-journal-"));
  const createOwnedJsonJournal = runnerModule.createOwnedJsonJournal;
  assert.equal(typeof createOwnedJsonJournal, "function");
  const journal = createOwnedJsonJournal(fixtureRoot, "processes.json", []);
  const journalPath = resolve(fixtureRoot, "processes.json");
  const sentinel = Buffer.from("replacement-process-journal\n");
  try {
    journal.write([{ sequence: 1 }]);
    unlinkSync(journalPath);
    writeFileSync(journalPath, sentinel, { flag: "wx", mode: 0o600 });

    // When/Then: the next update rejects the path takeover and preserves its bytes.
    assert.throws(
      () => journal.write([{ sequence: 2 }]),
      (error) => error?.code === "RUNNER_OUTPUT_COLLISION",
    );
    assert.deepEqual(readFileSync(journalPath), sentinel);
  } finally {
    journal?.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`Gate38 ${signal} during early setup cleans once and exits by code`, async () => {
    // Given: a real subprocess reports its listener-armed early-setup seam over IPC.
    const trace = await runEarlySetupSignal(signal);
    try {
      // When: the parent delivers the real POSIX signal at that observed seam.
      assert.equal(trace.signalSent, true);
      assert.equal(trace.armedMessages.length, 1);
      assert.deepEqual(trace.armedMessages[0], {
        type: "armed",
        runnerTmpdir: trace.runnerTmpdir,
        sigintListeners: 1,
        sigtermListeners: 1,
      });

      // Then: the runner handles it, cleans exactly once, and exits by canonical code.
      assert.equal(trace.terminationSignal, null, trace.stderr);
      assert.equal(trace.code, signal === "SIGINT" ? 130 : 143, trace.stderr);
      assert.equal(existsSync(resolve(trace.fixture.attemptDir, "real-surface")), false);
      if (trace.runnerTmpdir) assert.equal(existsSync(trace.runnerTmpdir), false);
      const settlements = existsSync(trace.cleanupMarker)
        ? readFileSync(trace.cleanupMarker, "utf8").trim().split(/\r?\n/u).filter(Boolean)
        : [];
      assert.equal(settlements.length, 2);
      assert.match(settlements[0], /^settled:\{"result":"PASS","totals":\{"processes":0,"listeners":0,"portOwners":0,"rebindPass":5\}\}$/u);
      assert.equal(settlements[1], `exit:${signal === "SIGINT" ? 130 : 143}:sigint=0:sigterm=0`);
      assert.equal(existsSync(resolve(trace.fixture.attemptDir, "finalization-manifest.json")), false);
      assert.equal(existsSync(resolve(trace.fixture.attemptDir, "receipt.json")), false);
    } finally {
      if (trace.runnerTmpdir && existsSync(trace.runnerTmpdir)) {
        rmSync(trace.runnerTmpdir, { recursive: true, force: true });
      }
      trace.fixture.cleanup();
    }
  });

  test(`Gate38 ${signal} during early setup exits 68 when managed cleanup fails`, async () => {
    // Given: the real signal seam is armed and cleanup settlement reports a failure.
    const trace = await runEarlySetupSignal(signal, { cleanupFails: true });
    try {
      // When: the parent delivers the signal while the asynchronous setup hook is pending.
      assert.equal(trace.signalSent, true);
      assert.equal(trace.armedMessages.length, 1);
      assert.deepEqual(trace.armedMessages[0], {
        type: "armed",
        runnerTmpdir: trace.runnerTmpdir,
        sigintListeners: 1,
        sigtermListeners: 1,
      });

      // Then: managed cleanup wins with exit 68 and retains its causal diagnostic.
      assert.equal(trace.terminationSignal, null, trace.stderr);
      assert.equal(trace.code, 68, trace.stderr);
      assert.match(trace.stderr, /REAL_SURFACE_CLEANUP_FAILED/u);
      assert.match(trace.stderr, /INJECTED_EARLY_SIGNAL_CLEANUP_FAILURE/u);
      assert.equal(existsSync(resolve(trace.fixture.attemptDir, "real-surface")), false);
      if (trace.runnerTmpdir) assert.equal(existsSync(trace.runnerTmpdir), false);
      const settlements = readFileSync(trace.cleanupMarker, "utf8").trim().split(/\r?\n/u).filter(Boolean);
      assert.equal(settlements.length, 2);
      assert.match(settlements[0], /^settled:\{"result":"PASS","totals":\{"processes":0,"listeners":0,"portOwners":0,"rebindPass":5\}\}$/u);
      assert.equal(settlements[1], "exit:68:sigint=0:sigterm=0");
      assert.equal(existsSync(resolve(trace.fixture.attemptDir, "finalization-manifest.json")), false);
      assert.equal(existsSync(resolve(trace.fixture.attemptDir, "receipt.json")), false);
    } finally {
      if (trace.runnerTmpdir && existsSync(trace.runnerTmpdir)) {
        rmSync(trace.runnerTmpdir, { recursive: true, force: true });
      }
      trace.fixture.cleanup();
    }
  });
}

test("Gate37 finalizer rejects CLI and controller run-context mismatch", () => {
  const fixture = createFinalizerFixture();
  try {
    assert.throws(
      () => finalizeFixture(fixture, { expectedRunId: "different-cli-run" }),
      /FINAL_RUN_CONTEXT_MISMATCH/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer rejects manifest run-context mismatch", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "finalization-manifest.json"), (manifest) => {
      manifest.runContext.expectedRunId = "different-manifest-run";
    });
    assert.throws(() => finalizeFixture(fixture), /FINAL_RUN_CONTEXT_MISMATCH/u);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer rejects review run-context mismatch", () => {
  const fixture = createFinalizerFixture();
  try {
    const reportPath = resolve(fixture.attemptDir, fixture.surfaceDescriptor.report);
    const expected = `RunContext: ${JSON.stringify(fixture.runContext)}`;
    const mismatched = `RunContext: ${JSON.stringify({
      ...fixture.runContext,
      expectedRunStartNs: (BigInt(fixture.runContext.expectedRunStartNs) + 1n).toString(),
    })}`;
    writeFileSync(reportPath, readFileSync(reportPath, "utf8").replace(expected, mismatched), "utf8");
    writeFixtureHandoff(fixture, fixture.surfaceDescriptor);
    assert.throws(() => finalizeFixture(fixture), /FINAL_RUN_CONTEXT_MISMATCH/u);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer rejects handoff run-context mismatch", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "review-handoffs/final-code.json"), (handoff) => {
      handoff.runContext.expectedRunStartNs = (BigInt(handoff.runContext.expectedRunStartNs) + 1n).toString();
    });
    assert.throws(() => finalizeFixture(fixture), /FINAL_RUN_CONTEXT_MISMATCH/u);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer rejects an internally ordered year-2000 phase-one bundle", () => {
  const fixture = createFinalizerFixture();
  try {
    const stale = new Date("2000-01-01T00:00:00.000Z");
    const orderedPaths = [
      ...fixture.manifest.artifacts.map((artifact) => resolve(fixture.attemptDir, artifact.path)),
      resolve(fixture.attemptDir, "finalization-manifest.json"),
      resolve(fixture.attemptDir, fixture.surfaceDescriptor.report),
      resolve(fixture.attemptDir, `review-handoffs/${fixture.surfaceDescriptor.name}`),
      resolve(fixture.attemptDir, fixture.finalDescriptor.report),
      resolve(fixture.attemptDir, `review-handoffs/${fixture.finalDescriptor.name}`),
    ];
    for (const path of orderedPaths) utimesSync(path, stale, stale);
    assert.throws(() => finalizeFixture(fixture), /FINAL_REVIEW_FRESHNESS_INVALID/u);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer permits canonical source files that predate the run lower bound", () => {
  const fixture = createFinalizerFixture();
  try {
    const sourceMetadata = lstatSync(resolve(fixture.sourceRoot, OWNED_PATHS[0]), { bigint: true });
    const expectedRunStartNs = BigInt(fixture.runContext.expectedRunStartNs);
    assert.ok(sourceMetadata.mtimeNs < expectedRunStartNs);
    assert.ok(sourceMetadata.ctimeNs < expectedRunStartNs);
    assert.equal(finalizeFixture(fixture).result, "PASS");
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer accepts the inclusive exact evidence lower boundary", () => {
  const fixture = createFinalizerFixture();
  try {
    const boundaryPath = resolve(fixture.attemptDir, fixture.manifest.artifacts[0].path);
    const boundaryMetadata = lstatSync(boundaryPath, { bigint: true });
    const boundaryNs = boundaryMetadata.mtimeNs < boundaryMetadata.ctimeNs
      ? boundaryMetadata.mtimeNs
      : boundaryMetadata.ctimeNs;
    rebindFixtureRunContext(fixture, {
      expectedRunId: fixture.runContext.expectedRunId,
      expectedRunStartNs: boundaryNs.toString(),
    });

    assert.equal(
      [boundaryMetadata.mtimeNs, boundaryMetadata.ctimeNs].some((value) => value === boundaryNs),
      true,
    );
    assert.equal(finalizeFixture(fixture).result, "PASS");
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer rejects a run ID found in independently derived prior evidence", () => {
  const fixture = createFinalizerFixture();
  try {
    const priorDir = resolve(dirname(fixture.attemptDir), "attempt-4");
    mkdirSync(priorDir);
    writeCanonicalJson(resolve(priorDir, "finalization-manifest.json"), {
      runId: fixture.runContext.expectedRunId,
    });
    rewriteCanonical(resolve(fixture.attemptDir, "controller-run-context.json"), (controller) => {
      controller.priorRunIds = [fixture.runContext.expectedRunId];
    });
    assert.throws(() => finalizeFixture(fixture), /FINAL_RUN_ID_REUSED/u);
  } finally {
    fixture.cleanup();
  }
});

test("Gate37 finalizer rejects malformed prior U002 evidence", () => {
  const fixture = createFinalizerFixture();
  try {
    const priorDir = resolve(dirname(fixture.attemptDir), "attempt-4");
    mkdirSync(priorDir);
    writeFileSync(resolve(priorDir, "finalization-manifest.json"), "not-json\n", "utf8");
    assert.throws(() => finalizeFixture(fixture), /FINAL_PRIOR_RUN_EVIDENCE_INVALID/u);
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects obsolete or mismatched authority", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "finalization-manifest.json"), (manifest) => {
      manifest.authority.dispatchSha256 = "0".repeat(64);
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINALIZATION_MANIFEST_INVALID/u,
    );
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    fixture.cleanup();
  }
});

test("Gate38 finalizer rejects any mismatched normative-section hash", () => {
  for (const field of ["gate36SectionSha256", "gate37SectionSha256", "gate38SectionSha256", "gate39SectionSha256"]) {
    const fixture = createFinalizerFixture();
    try {
      rewriteCanonical(resolve(fixture.attemptDir, "finalization-manifest.json"), (manifest) => {
        manifest[field] = "0".repeat(64);
      });

      assert.throws(
        () => finalizeFixture(fixture),
        /FINALIZATION_MANIFEST_INVALID/u,
        field,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("Gate36 finalizer rejects an extra manifest field under the closed schema", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "finalization-manifest.json"), (manifest) => {
      manifest.unapproved = true;
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINALIZATION_MANIFEST_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects an extra handoff field under the closed schema", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "review-handoffs/surface-qa.json"), (handoff) => {
      handoff.unapproved = true;
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_HANDOFF_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects a wrong handoff schema version", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "review-handoffs/surface-qa.json"), (handoff) => {
      handoff.schemaVersion = 2;
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_HANDOFF_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects the former incomplete eighteen-artifact fixture", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "finalization-manifest.json"), (manifest) => {
      manifest.artifacts = manifest.artifacts.slice(0, 18);
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINALIZATION_MANIFEST_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects a ninety-five-artifact substitute", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "finalization-manifest.json"), (manifest) => {
      manifest.artifacts = manifest.artifacts.slice(0, 95);
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINALIZATION_MANIFEST_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

for (const [name, mutate] of [
  ["unsorted", (aggregate) => { [aggregate.entries[0], aggregate.entries[1]] = [aggregate.entries[1], aggregate.entries[0]]; }],
  ["ninety-five", (aggregate) => { aggregate.entries.pop(); aggregate.count = 95; }],
  ["duplicate", (aggregate) => { aggregate.entries[1] = aggregate.entries[0]; }],
]) {
  test(`Gate36 finalizer rejects ${name} canonical source entries`, () => {
    const fixture = createFinalizerFixture();
    try {
      rewriteCanonical(resolve(fixture.attemptDir, "finalization-manifest.json"), (manifest) => {
        mutate(manifest.sourceAggregate);
      });
      assert.throws(
        () => finalizeFixture(fixture),
        /FINALIZATION_SOURCE_INTEGRITY_INVALID/u,
      );
    } finally {
      fixture.cleanup();
    }
  });
}

test("Gate36 finalizer rejects a handoff source aggregate that differs from the manifest", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "review-handoffs/surface-qa.json"), (handoff) => {
      handoff.sourceAggregate.sha256 = "0".repeat(64);
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_HANDOFF_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

for (const [name, mutate] of [
  ["unsorted", (artifacts) => { [artifacts[0], artifacts[1]] = [artifacts[1], artifacts[0]]; }],
  ["duplicate", (artifacts) => { artifacts[1] = artifacts[0]; }],
]) {
  test(`Gate36 finalizer rejects ${name} artifact records`, () => {
    const fixture = createFinalizerFixture();
    try {
      rewriteCanonical(resolve(fixture.attemptDir, "finalization-manifest.json"), (manifest) => {
        mutate(manifest.artifacts);
      });
      assert.throws(
        () => finalizeFixture(fixture),
        /FINALIZATION_MANIFEST_INVALID/u,
      );
    } finally {
      fixture.cleanup();
    }
  });
}

test("Gate36 finalizer rejects contradictory PASS and FAIL review declarations", () => {
  const fixture = createFinalizerFixture();
  try {
    const reportPath = resolve(fixture.attemptDir, fixture.surfaceDescriptor.report);
    writeFileSync(reportPath, `${readFileSync(reportPath, "utf8")}Verdict: FAIL\n`, "utf8");
    writeFixtureHandoff(fixture, fixture.surfaceDescriptor);

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_CONTRADICTORY/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects combined PASS and REQUEST_CHANGES review declarations", () => {
  const fixture = createFinalizerFixture();
  try {
    const reportPath = resolve(fixture.attemptDir, fixture.surfaceDescriptor.report);
    writeFileSync(reportPath, `${readFileSync(reportPath, "utf8")}Recommendation: REQUEST_CHANGES\n`, "utf8");
    writeFixtureHandoff(fixture, fixture.surfaceDescriptor);

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_CONTRADICTORY/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects a handoff bound to the wrong Markdown report", () => {
  const fixture = createFinalizerFixture();
  try {
    rewriteCanonical(resolve(fixture.attemptDir, "review-handoffs/final-code.json"), (handoff) => {
      handoff.report = fileRecord(fixture.attemptDir, "surface-qa-review.md");
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_HANDOFF_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects a review missing one of the ninety-six source records", () => {
  const fixture = createFinalizerFixture();
  try {
    const reportPath = resolve(fixture.attemptDir, fixture.surfaceDescriptor.report);
    const lines = readFileSync(reportPath, "utf8").split("\n");
    lines.splice(lines.findIndex((line) => line.startsWith("Source: ")), 1);
    writeFileSync(reportPath, lines.join("\n"), "utf8");
    writeFixtureHandoff(fixture, fixture.surfaceDescriptor);

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_SOURCE_BINDING_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects a review with unsorted artifact records", () => {
  const fixture = createFinalizerFixture();
  try {
    const reportPath = resolve(fixture.attemptDir, fixture.finalDescriptor.report);
    const lines = readFileSync(reportPath, "utf8").split("\n");
    const first = lines.findIndex((line) => line.startsWith("Artifact: "));
    [lines[first], lines[first + 1]] = [lines[first + 1], lines[first]];
    writeFileSync(reportPath, lines.join("\n"), "utf8");
    writeFixtureHandoff(fixture, fixture.finalDescriptor);

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_ARTIFACT_BINDING_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects an overwritten review after its controller handoff", () => {
  const fixture = createFinalizerFixture();
  try {
    const reportPath = resolve(fixture.attemptDir, fixture.surfaceDescriptor.report);
    writeFileSync(reportPath, readFileSync(reportPath));

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_FRESHNESS_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects wrong role and review order", () => {
  const fixture = createFinalizerFixture();
  try {
    const handoffPath = resolve(fixture.attemptDir, "review-handoffs/surface-qa.json");
    rewriteCanonical(handoffPath, (handoff) => {
      handoff.role = "final-code";
      handoff.reviewOrder = 2;
    });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_HANDOFF_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

for (const identity of ["taskId", "sessionId"]) {
  test(`Gate36 finalizer rejects reused ${identity}`, () => {
    const fixture = createFinalizerFixture();
    try {
      const handoffPath = resolve(fixture.attemptDir, "review-handoffs/final-code.json");
      rewriteCanonical(handoffPath, (handoff) => {
        handoff[identity] = fixture.surfaceHandoff[identity];
      });

      assert.throws(
        () => finalizeFixture(fixture),
        /FINAL_REVIEW_HANDOFF_REUSED_IDENTITY/u,
      );
    } finally {
      fixture.cleanup();
    }
  });
}

test("Gate36 finalizer rejects handoffs sharing a hardlinked inode", () => {
  const fixture = createFinalizerFixture();
  try {
    const surfacePath = resolve(fixture.attemptDir, "review-handoffs/surface-qa.json");
    const finalPath = resolve(fixture.attemptDir, "review-handoffs/final-code.json");
    unlinkSync(finalPath);
    linkSync(surfacePath, finalPath);

    assert.throws(
      () => finalizeFixture(fixture),
      /FINALIZATION_ARTIFACT_NOT_REGULAR/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects manifest-review-handoff timestamp disorder", () => {
  const fixture = createFinalizerFixture();
  try {
    const manifestTime = statSync(resolve(fixture.attemptDir, "finalization-manifest.json")).mtimeMs;
    const stale = new Date(manifestTime - 60_000);
    utimesSync(resolve(fixture.attemptDir, "surface-qa-review.md"), stale, stale);

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_FRESHNESS_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects a handoff timestamp after finalizer start", () => {
  const fixture = createFinalizerFixture();
  try {
    const future = new Date(Date.now() + 60_000);
    utimesSync(resolve(fixture.attemptDir, "review-handoffs/final-code.json"), future, future);

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_REVIEW_FUTURE_TIMESTAMP/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects an internally ordered evidence set whose mtimes are still in the future", () => {
  const fixture = createFinalizerFixture();
  try {
    const futureMilliseconds = Date.now() + 60_000;
    const futureSeconds = futureMilliseconds / 1_000;
    const orderedPaths = [
      ...fixture.manifest.artifacts.map((artifact) => resolve(fixture.attemptDir, artifact.path)),
      resolve(fixture.attemptDir, "finalization-manifest.json"),
      resolve(fixture.attemptDir, fixture.surfaceDescriptor.report),
      resolve(fixture.attemptDir, `review-handoffs/${fixture.surfaceDescriptor.name}`),
      resolve(fixture.attemptDir, fixture.finalDescriptor.report),
      resolve(fixture.attemptDir, `review-handoffs/${fixture.finalDescriptor.name}`),
    ];
    for (const path of orderedPaths) utimesSync(path, futureSeconds, futureSeconds);
    const minimumFutureMtimeNs = orderedPaths.reduce((minimum, path) => {
      const { mtimeNs } = lstatSync(path, { bigint: true });
      return mtimeNs < minimum ? mtimeNs : minimum;
    }, lstatSync(orderedPaths[0], { bigint: true }).mtimeNs);
    const probeUpperBoundNs = minimumFutureMtimeNs - 1n;

    withClockProbeTimestamp(
      fixture.attemptDir,
      probeUpperBoundNs,
      () => assert.throws(
        () => finalizeFixture(fixture),
        /FINAL_REVIEW_FUTURE_TIMESTAMP/u,
      ),
    );
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    fixture.cleanup();
  }
});

for (const [name, prepare] of [
  ["symlinked attempt root", (fixture) => {
    const escaped = resolve(fixture.fixtureRoot, "escaped-attempt");
    renameSync(fixture.attemptDir, escaped);
    symlinkSync(escaped, fixture.attemptDir, "dir");
  }],
  ["symlinked canonical-source ancestor", (fixture) => {
    const ancestor = resolve(fixture.sourceRoot, "packages/agent");
    const escaped = resolve(fixture.fixtureRoot, "escaped-source-ancestor");
    renameSync(ancestor, escaped);
    symlinkSync(escaped, ancestor, "dir");
  }],
  ["symlinked artifact ancestor", (fixture) => {
    const ancestor = resolve(fixture.attemptDir, "real-surface/requests");
    const escaped = resolve(fixture.fixtureRoot, "escaped-artifact-ancestor");
    renameSync(ancestor, escaped);
    symlinkSync(escaped, ancestor, "dir");
  }],
  ["symlinked handoff ancestor", (fixture) => {
    const ancestor = resolve(fixture.attemptDir, "review-handoffs");
    const escaped = resolve(fixture.fixtureRoot, "escaped-handoff-ancestor");
    renameSync(ancestor, escaped);
    symlinkSync(escaped, ancestor, "dir");
  }],
]) {
  test(`Gate36 finalizer rejects ${name}`, () => {
    const fixture = createFinalizerFixture();
    try {
      prepare(fixture);
      assert.throws(
        () => finalizeFixture(fixture),
        /FINALIZATION_PATH_(?:ANCESTOR_INVALID|ESCAPE)/u,
      );
      assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    } finally {
      fixture.cleanup();
    }
  });
}

for (const [name, prepare] of [
  ["source symlink", (fixture) => {
    const path = resolve(fixture.sourceRoot, OWNED_PATHS[0]);
    unlinkSync(path);
    symlinkSync(resolve(fixture.sourceRoot, OWNED_PATHS[1]), path);
  }],
  ["source hardlink", (fixture) => {
    const path = resolve(fixture.sourceRoot, OWNED_PATHS[0]);
    unlinkSync(path);
    linkSync(resolve(fixture.sourceRoot, OWNED_PATHS[1]), path);
  }],
  ["source replacement", (fixture) => replaceWithSameBytes(resolve(fixture.sourceRoot, OWNED_PATHS[0]))],
  ["artifact symlink", (fixture) => {
    const path = resolve(fixture.attemptDir, "real-surface/result.json");
    unlinkSync(path);
    symlinkSync(resolve(fixture.attemptDir, "negative-matrix.json"), path);
  }],
  ["artifact hardlink", (fixture) => {
    const path = resolve(fixture.attemptDir, "real-surface/result.json");
    unlinkSync(path);
    linkSync(resolve(fixture.attemptDir, "negative-matrix.json"), path);
  }],
  ["artifact replacement", (fixture) => replaceWithSameBytes(resolve(fixture.attemptDir, "real-surface/result.json"))],
]) {
  test(`Gate36 finalizer rejects ${name}`, () => {
    const fixture = createFinalizerFixture();
    try {
      prepare(fixture);
      assert.throws(
        () => finalizeFixture(fixture),
        /FINALIZATION_(?:ARTIFACT|SOURCE)/u,
      );
      assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    } finally {
      fixture.cleanup();
    }
  });
}

test("Gate36 finalizer detects current-source mutation immediately before link", () => {
  const fixture = createFinalizerFixture();
  try {
    assert.throws(
      () => finalizeFixture(fixture, {
        beforeInstall: () => writeFileSync(
          resolve(fixture.sourceRoot, OWNED_PATHS[0]),
          "mutated-before-link\n",
          "utf8",
        ),
      }),
      /FINALIZATION_ARTIFACT_CHANGED/u,
    );
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    assert.deepEqual(receiptTemporaryNames(fixture.attemptDir), []);
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer detects review inode replacement immediately before link", () => {
  const fixture = createFinalizerFixture();
  try {
    assert.throws(
      () => finalizeFixture(fixture, {
        beforeInstall: () => replaceWithSameBytes(resolve(fixture.attemptDir, "final-code-review.md")),
      }),
      /FINALIZATION_ARTIFACT_NOT_REGULAR/u,
    );
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    assert.deepEqual(receiptTemporaryNames(fixture.attemptDir), []);
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer failure leaves no receipt or exclusive temporary file", () => {
  const fixture = createFinalizerFixture();
  try {
    assert.throws(
      () => finalizeFixture(fixture, {
        beforeInstall: () => { throw new Error("injected-before-link-failure"); },
      }),
      /injected-before-link-failure/u,
    );
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    assert.deepEqual(receiptTemporaryNames(fixture.attemptDir), []);
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 finalizer rejects staged product paths in the isolated source repository", () => {
  const fixture = createFinalizerFixture();
  try {
    execFileSync("git", ["add", "--", OWNED_PATHS[0]], { cwd: fixture.sourceRoot, stdio: "ignore" });

    assert.throws(
      () => finalizeFixture(fixture),
      /FINAL_STAGED_PRODUCT_PATHS/u,
    );
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 concurrent finalizers produce exactly one PASS and one no-overwrite failure", async () => {
  const fixture = createFinalizerFixture();
  try {
    const results = await Promise.all([runFinalizerChild(fixture), runFinalizerChild(fixture)]);
    const passes = results.filter((result) => result.status === 0 && result.stdout === "PASS\n");
    const collisions = results.filter((result) => (
      result.status === 68 && result.stderr.includes("FINAL_RECEIPT_ALREADY_EXISTS")
    ));

    assert.equal(passes.length, 1, JSON.stringify(results));
    assert.equal(collisions.length, 1, JSON.stringify(results));
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), true);
    assert.deepEqual(receiptTemporaryNames(fixture.attemptDir), []);
    assert.deepEqual(finalizerClockProbeNames(fixture.attemptDir), []);
  } finally {
    fixture.cleanup();
  }
});

test("Gate36 runner writes only the phase-one manifest and rejects preexisting finalization inputs", () => {
  const fixture = createFinalizerFixture();
  try {
    unlinkSync(resolve(fixture.attemptDir, "review-handoffs/surface-qa.json"));
    unlinkSync(resolve(fixture.attemptDir, "review-handoffs/final-code.json"));
    unlinkSync(resolve(fixture.attemptDir, "surface-qa-review.md"));
    unlinkSync(resolve(fixture.attemptDir, "final-code-review.md"));
    unlinkSync(resolve(fixture.attemptDir, "finalization-manifest.json"));
    const controllerPath = resolve(fixture.attemptDir, "controller-run-context.json");
    const controllerBytes = readFileSync(controllerPath);
    const controllerMetadata = lstatSync(controllerPath, { bigint: true });
    const result = writePhaseOneFinalizationManifest({
      attemptDir: fixture.attemptDir,
      config: {
        runId: fixture.manifest.runId,
        runContext: fixture.runContext,
        ports: fixture.manifest.ports,
      },
      artifacts: fixture.manifest.artifacts,
      sourceIntegrity: fixture.sourceIntegrity,
      focusedEvidence: {
        suites: {
          workflow: { testCount: 1 },
          engineer: { testCount: 1 },
          business: { testCount: 1 },
        },
        pptx: { sourceAbsent: true },
      },
    });

    assert.equal(result.manifest.sourceAggregate.entries.length, 96);
    assert.deepEqual(result.manifest.runContext, fixture.runContext);
    assert.deepEqual(readFileSync(controllerPath), controllerBytes);
    const controllerAfter = lstatSync(controllerPath, { bigint: true });
    assert.equal(controllerAfter.dev, controllerMetadata.dev);
    assert.equal(controllerAfter.ino, controllerMetadata.ino);
    assert.equal(existsSync(resolve(fixture.attemptDir, "receipt.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "review-handoffs/surface-qa.json")), false);
    assert.equal(existsSync(resolve(fixture.attemptDir, "review-handoffs/final-code.json")), false);
    for (const path of [
      "receipt.json",
      "surface-qa-review.md",
      "final-code-review.md",
      "review-handoffs/surface-qa.json",
      "review-handoffs/final-code.json",
    ]) {
      const absolutePath = resolve(fixture.attemptDir, path);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, "preexisting\n", "utf8");
      assert.throws(
        () => assertRunnerFinalizationInputsFresh(fixture.attemptDir),
        /FINALIZATION_PHASE_ONE_NOT_FRESH/u,
      );
      unlinkSync(absolutePath);
    }
  } finally {
    fixture.cleanup();
  }
});

test("Gate35 surface QA links require the exact current regular artifact set", () => {
  const attemptDir = mkdtempSync(resolve(tmpdir(), "u002-surface-qa-links-"));
  try {
    mkdirSync(resolve(attemptDir, "nested"));
    writeFileSync(resolve(attemptDir, "result.json"), '{"result":"PASS"}\n', "utf8");
    writeFileSync(resolve(attemptDir, "nested/evidence.log"), "evidence\n", "utf8");
    const artifacts = buildOwnedSourceManifest(attemptDir, [
      "nested/evidence.log",
      "result.json",
    ]).entries;
    const surfaceQaPath = resolve(attemptDir, "surface-qa.md");
    const render = (records) => [
      "# Fixture QA",
      "",
      ...records.map((artifact) => (
        `- [${artifact.path}](${artifact.path}) — sha256=${artifact.sha256}, bytes=${artifact.bytes}`
      )),
      "",
    ].join("\n");

    writeFileSync(surfaceQaPath, render(artifacts), "utf8");
    assert.deepEqual(validateSurfaceQaLinks(surfaceQaPath, artifacts, attemptDir), {
      linkCount: 2,
      paths: ["nested/evidence.log", "result.json"],
    });

    writeFileSync(surfaceQaPath, render(artifacts.slice(1)), "utf8");
    assert.throws(
      () => validateSurfaceQaLinks(surfaceQaPath, artifacts, attemptDir),
      /SURFACE_QA_LINK_MISMATCH/u,
    );
    writeFileSync(
      surfaceQaPath,
      render([{ ...artifacts[0], path: "../forged.log" }, artifacts[1]]),
      "utf8",
    );
    assert.throws(
      () => validateSurfaceQaLinks(surfaceQaPath, artifacts, attemptDir),
      /SURFACE_QA_LINK_MISMATCH/u,
    );
  } finally {
    rmSync(attemptDir, { recursive: true, force: true });
  }
});


test("Gate39 accepts the exact historical attempt-2 dispatcher snapshot bytes inside prior derivation", () => {
  // Given: isolated fixture copies of historical attempt-2 non-canonical bytes plus five other prior identities.
  const HIST = "/Users/jmpark/Playground/sangfor-os/.omo/evidence/sangfor-system-refactor-2026-07-15/U002/attempt-2/dispatcher/snapshot.json";
  const histBytes = readFileSync(HIST);
  assert.equal(histBytes.length, 5507);
  assert.equal(createHash("sha256").update(histBytes).digest("hex"), "792679bd0b58ed762f36654bfcfaa92cda1731ba0fab1d36c814b1325608e791");
  const expectedPriorRunIds = [
    "09821E4E-ECC4-410E-A8FA-DB8B290C0000",
    "7572F805-1964-4671-ADD7-79774C8C2893",
    "8D56404A-D4CC-4A33-AEC5-8EF9B8F163F8",
    "9D7F41A4-C191-49DF-BF9C-BBE7B0B6273B",
    "u002-attempt5-4e9949aa-21ff-4b19-8485-49e682e5738f",
    "u002-attempt6-7b112389-cf24-46c9-8a8a-4ad55826e223",
  ];
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "u002-gate39-legacy-green-"));
  const attemptDir = resolve(fixtureRoot, "U002/attempt-7");
  mkdirSync(attemptDir, { recursive: true });
  const runContext = {
    expectedRunId: "u002-attempt7-fixture",
    expectedRunStartNs: (BigInt(Date.now() - 1_000) * 1_000_000n).toString(),
  };
  try {
    writeCanonicalJson(resolve(fixtureRoot, "U002/attempt-1/dispatcher/snapshot.json"), {
      schemaVersion: 1, unit: "U002", attempt: 1, runId: expectedPriorRunIds[1],
    });
    mkdirSync(resolve(fixtureRoot, "U002/attempt-2/dispatcher"), { recursive: true });
    writeFileSync(resolve(fixtureRoot, "U002/attempt-2/dispatcher/snapshot.json"), histBytes);
    writeCanonicalJson(resolve(fixtureRoot, "U002/attempt-3/dispatcher/snapshot.json"), {
      schemaVersion: 1, unit: "U002", attempt: 3, runId: expectedPriorRunIds[3],
    });
    writeCanonicalJson(resolve(fixtureRoot, "U002/attempt-4/dispatcher/snapshot.json"), {
      schemaVersion: 1, unit: "U002", attempt: 4, runId: expectedPriorRunIds[0],
    });
    for (const [n, id, priors] of [
      [5, expectedPriorRunIds[4], [expectedPriorRunIds[1]]],
      [6, expectedPriorRunIds[5], expectedPriorRunIds.slice(0, 5)],
    ]) {
      const controller = resolve(fixtureRoot, `U002/attempt-${n}/controller-run-context.json`);
      writeCanonicalJson(controller, {
        schemaVersion: 1,
        unit: "U002",
        runContext: { expectedRunId: id, expectedRunStartNs: "1" },
        priorRunIds: priors,
      });
      chmodSync(controller, 0o600);
    }
    const controllerPath = resolve(attemptDir, "controller-run-context.json");
    writeCanonicalJson(controllerPath, {
      schemaVersion: 1,
      unit: "U002",
      runContext,
      priorRunIds: expectedPriorRunIds,
    });
    chmodSync(controllerPath, 0o600);

    // When: runner derives priors for attempt-7.
    const result = validateRunnerRunContext(attemptDir, runContext);

    // Then: exact six-id set including the burned attempt-6 id, and historical original remains unchanged.
    assert.deepEqual(result, { runContext, priorRunIds: expectedPriorRunIds });
    assert.deepEqual(readFileSync(HIST), histBytes);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Gate39 rejects one-byte mutation, alternate attempt path, and generic non-canonical prior snapshots", () => {
  const HIST = "/Users/jmpark/Playground/sangfor-os/.omo/evidence/sangfor-system-refactor-2026-07-15/U002/attempt-2/dispatcher/snapshot.json";
  const histBytes = readFileSync(HIST);
  for (const variant of ["mutate-byte", "wrong-attempt", "generic-noncanonical"]) {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), `u002-gate39-legacy-fail-${variant}-`));
    const attemptDir = resolve(fixtureRoot, "U002/attempt-7");
    mkdirSync(attemptDir, { recursive: true });
    const runContext = {
      expectedRunId: "u002-attempt7-fail-fixture",
      expectedRunStartNs: (BigInt(Date.now() - 1_000) * 1_000_000n).toString(),
    };
    try {
      writeCanonicalJson(resolve(fixtureRoot, "U002/attempt-1/dispatcher/snapshot.json"), {
        schemaVersion: 1, unit: "U002", attempt: 1, runId: "run-1",
      });
      if (variant === "wrong-attempt") {
        mkdirSync(resolve(fixtureRoot, "U002/attempt-3/dispatcher"), { recursive: true });
        writeFileSync(resolve(fixtureRoot, "U002/attempt-3/dispatcher/snapshot.json"), histBytes);
      } else if (variant === "mutate-byte") {
        mkdirSync(resolve(fixtureRoot, "U002/attempt-2/dispatcher"), { recursive: true });
        const mutated = Buffer.from(histBytes);
        mutated[0] = mutated[0] ^ 0x01;
        writeFileSync(resolve(fixtureRoot, "U002/attempt-2/dispatcher/snapshot.json"), mutated);
      } else {
        mkdirSync(resolve(fixtureRoot, "U002/attempt-2/dispatcher"), { recursive: true });
        // parseable non-canonical compact JSON that is not the exact legacy hash
        writeFileSync(
          resolve(fixtureRoot, "U002/attempt-2/dispatcher/snapshot.json"),
          '{"schemaVersion":1,"unit":"U002","attempt":2,"runId":"8D56404A-D4CC-4A33-AEC5-8EF9B8F163F8"}\n',
        );
      }
      const controllerPath = resolve(attemptDir, "controller-run-context.json");
      writeCanonicalJson(controllerPath, {
        schemaVersion: 1,
        unit: "U002",
        runContext,
        priorRunIds: ["run-1"],
      });
      chmodSync(controllerPath, 0o600);

      assert.throws(
        () => validateRunnerRunContext(attemptDir, runContext),
        /FINAL_PRIOR_RUN_EVIDENCE_INVALID/u,
        variant,
      );
      assert.deepEqual(readFileSync(HIST), histBytes);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});


test("Gate39 keeps parseStableJson rejecting non-canonical non-legacy dispatcher snapshots", () => {
  const fixture = createGate38RunnerFixture([]);
  const snapshotPath = resolve(fixture.fixtureRoot, "U002/attempt-4/dispatcher/snapshot.json");
  mkdirSync(dirname(snapshotPath), { recursive: true });
  try {
    writeFileSync(
      snapshotPath,
      '{"schemaVersion":1,"unit":"U002","attempt":4,"runId":"run-a"}\n',
      "utf8",
    );
    assert.throws(
      () => validateRunnerRunContext(fixture.attemptDir, fixture.runContext),
      /FINAL_PRIOR_RUN_EVIDENCE_INVALID/u,
    );
  } finally {
    fixture.cleanup();
  }
});
