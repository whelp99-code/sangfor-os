import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { withIsolatedPostgresPair, LABEL_RUN, LABEL_UNIT, LABEL_PURPOSE } from "./lib/isolated-postgres.mjs";
import { parseRestoreDrillArgs, EXIT, STAGE_FOR_EXIT, fail } from "./lib/restore-drill/contract.mjs";
import { applyDeterministicSeed } from "./lib/restore-drill/fixture-seed.mjs";
import { createLogicalDump, restoreLogicalDump } from "./lib/restore-drill/logical-backup.mjs";
import {
  fetchSchemaRows,
  fetchTableRows,
  fetchSequenceRows,
  fetchConstraintRows,
  writeComparisonArtifact,
  checkMigrationIdempotency,
  writeValidationReport,
} from "./lib/restore-drill/database-inventory.mjs";
import { validateAgainstSchemaFile, atomicWriteJson } from "./lib/restore-drill/receipt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const RECEIPT_SCHEMA_PATH = join(REPO_ROOT, "scripts/restore-drill-receipt.schema.json");
const PURPOSE = "full-restore";
const RPO_THRESHOLD_MS = 90_000_000;
const RTO_THRESHOLD_MS = 900_000;
const EMPTY_CHECKS = Object.freeze({
  dump: "SKIPPED", restore: "SKIPPED", schema: "SKIPPED", tableCount: "SKIPPED",
  contentHash: "SKIPPED", sequence: "SKIPPED", constraint: "SKIPPED",
  migrationIdempotency: "SKIPPED", rpo: "SKIPPED", rto: "SKIPPED",
});

function parseConnection(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

function dockerExec(containerName, password, argv, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", ["exec", "-i", "-e", `PGPASSWORD=${password}`, containerName, ...argv], {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
    child.on("close", (code) => {
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      resolvePromise({ code: code ?? 1, stdoutBuffer, stdout: stdoutBuffer.toString("utf8"), stderr });
    });
  });
}

function buildSide(ctx, runId, purposeSuffix) {
  const conn = parseConnection(ctx.databaseUrl);
  return {
    databaseUrl: ctx.databaseUrl,
    migrationDatabaseUrl: ctx.migrationDatabaseUrl,
    containerId: ctx.containerName,
    labels: {
      [LABEL_RUN]: runId,
      [LABEL_UNIT]: "U009",
      [LABEL_PURPOSE]: `${PURPOSE}${purposeSuffix}`,
    },
    exec: (argv, opts) => dockerExec(ctx.containerName, conn.password, argv, opts),
    receipt: ctx.receipt,
    sentinel: ctx.sentinel,
  };
}

async function verifySentinelMatch(side) {
  const { user, database } = parseConnection(side.databaseUrl);
  const result = await side.exec([
    "psql", "-h", "127.0.0.1", "-U", user, "-d", database, "-t", "-A", "-c",
    `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${database.replace(/'/g, "''")}';`,
  ]);
  if (result.code !== 0) return false;
  try {
    const readBack = JSON.parse(result.stdout.trim());
    return Object.keys(side.sentinel).every((key) => readBack[key] === side.sentinel[key]);
  } catch {
    return false;
  }
}

async function prepareRestoreRoles(side) {
  const { user, database } = parseConnection(side.databaseUrl);
  const result = await side.exec([
    "psql", "-h", "127.0.0.1", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c",
    `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sangfor_app') THEN
    CREATE ROLE sangfor_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sangfor_app_login') THEN
    CREATE ROLE sangfor_app_login WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  GRANT sangfor_app TO sangfor_app_login WITH INHERIT FALSE, SET TRUE;
END
$$;`,
  ]);
  if (result.code !== 0) {
    throw fail(EXIT.RESTORE, "restore", `restore role preparation failed: ${result.stderr || result.stdout}`);
  }
}

function sanitizedEnv(extra) {
  const allowed = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "NVM_DIR", "NO_COLOR", "TMPDIR", "XDG_CACHE_HOME", "COREPACK_HOME", "PNPM_HOME", "SHELL"];
  const env = {};
  for (const key of allowed) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

function spawnCapture(argv, env) {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { shell: false, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

async function runMigrateDeploy(migrationDatabaseUrl) {
  const argv = ["bash", join(REPO_ROOT, "scripts/run-workspace-runtime.sh"), "root", "--", "corepack", "pnpm", "db:migrate:deploy"];
  const result = await spawnCapture(argv, sanitizedEnv({ DATABASE_URL: migrationDatabaseUrl }));
  if (result.code !== 0) {
    throw fail(EXIT.BACKUP, "backup", `source db:migrate:deploy failed: ${result.stderr || result.stdout}`);
  }
}

async function labelResourceCounts(runId, purposeSuffix) {
  const filters = [
    `label=${LABEL_RUN}=${runId}`,
    `label=${LABEL_UNIT}=U009`,
    `label=${LABEL_PURPOSE}=${PURPOSE}${purposeSuffix}`,
  ];
  const countFor = (argvBase) =>
    spawnCapture([...argvBase, ...filters.flatMap((f) => ["--filter", f])], sanitizedEnv({})).then((r) =>
      r.stdout.trim() ? r.stdout.trim().split("\n").filter(Boolean).length : 0,
    );
  const [containers, networks, volumes] = await Promise.all([
    countFor(["docker", "ps", "-aq"]),
    countFor(["docker", "network", "ls", "-q"]),
    countFor(["docker", "volume", "ls", "-q"]),
  ]);
  return { containers, networks, volumes };
}

async function runDrillBody({ primary, secondary, args, partial, checkAborted }) {
  const source = buildSide(primary, args.runId, "-a");
  const target = buildSide(secondary, args.runId, "-b");
  const scenario = args.failureScenario;

  checkAborted();
  await runMigrateDeploy(source.migrationDatabaseUrl);

  checkAborted();
  const seed = await applyDeterministicSeed(source);
  partial.fixtureSha256 = seed.sha256;
  const backupWindowStart = new Date();

  partial.sourceSentinelMatch = await verifySentinelMatch(source);
  if (!partial.sourceSentinelMatch) throw fail(EXIT.BACKUP, "backup", "source sentinel mismatch before dump");

  checkAborted();
  const dump = await createLogicalDump(source, args.evidenceDir, { injectCorruption: scenario === "corrupt-dump" });
  partial.checks.dump = "PASS";
  const dumpCompletedAt = new Date();
  const rpoMs = dumpCompletedAt.getTime() - backupWindowStart.getTime();
  writeFileSync(join(args.evidenceDir, "fixture.sha256"), `${seed.sha256}\n`);

  partial.targetSentinelMatch = await verifySentinelMatch(target);
  if (!partial.targetSentinelMatch) throw fail(EXIT.RESTORE, "restore", "target sentinel mismatch before restore");

  checkAborted();
  await prepareRestoreRoles(target);
  const restoreStartedAt = new Date();
  await restoreLogicalDump(target, dump.bytes, { injectFailure: scenario === "target-restore-failure" });
  if (scenario === "corrupt-dump") {
    // A corrupted dump.custom must fail inside pg_restore itself; reaching
    // here without an exception means the injection did not reproduce a
    // real restore failure, which is itself a test-fixture contract bug.
    throw fail(EXIT.RESTORE, "restore", "corrupt-dump scenario did not fail pg_restore as expected");
  }
  partial.checks.restore = "PASS";

  if (scenario === "validation-timeout") {
    partial.checks.rto = "FAIL";
    throw fail(EXIT.VALIDATION, "validation", "validation-timeout: exceeded provisional RTO budget");
  }

  checkAborted();
  const [sourceSchema, targetSchema] = await Promise.all([fetchSchemaRows(source), fetchSchemaRows(target)]);
  const schemaComparison = writeComparisonArtifact(args.evidenceDir, "schema-inventory.json", sourceSchema, targetSchema);
  partial.checks.schema = schemaComparison.match ? "PASS" : "FAIL";
  if (!schemaComparison.match) throw fail(EXIT.VALIDATION, "validation", "schema-inventory mismatch");

  const [sourceTables, targetTables] = await Promise.all([fetchTableRows(source), fetchTableRows(target)]);
  const tableComparison = writeComparisonArtifact(
    args.evidenceDir, "table-inventory.json", sourceTables, targetTables,
    { injectMismatch: scenario === "content-hash-mismatch" },
  );
  partial.checks.tableCount = tableComparison.match ? "PASS" : "FAIL";
  partial.checks.contentHash = tableComparison.match ? "PASS" : "FAIL";
  if (!tableComparison.match) throw fail(EXIT.VALIDATION, "validation", "table-inventory mismatch");

  const [sourceSequences, targetSequences] = await Promise.all([fetchSequenceRows(source), fetchSequenceRows(target)]);
  const sequenceComparison = writeComparisonArtifact(
    args.evidenceDir, "sequence-inventory.json", sourceSequences, targetSequences,
    { injectMismatch: scenario === "sequence-mismatch" },
  );
  partial.checks.sequence = sequenceComparison.match ? "PASS" : "FAIL";
  if (!sequenceComparison.match) throw fail(EXIT.VALIDATION, "validation", "sequence-inventory mismatch");

  const [sourceConstraints, targetConstraints] = await Promise.all([fetchConstraintRows(source), fetchConstraintRows(target)]);
  const constraintComparison = writeComparisonArtifact(args.evidenceDir, "constraint-inventory.json", sourceConstraints, targetConstraints);
  partial.checks.constraint = constraintComparison.match ? "PASS" : "FAIL";
  if (!constraintComparison.match) throw fail(EXIT.VALIDATION, "validation", "constraint-inventory mismatch");

  const idempotency = await checkMigrationIdempotency(REPO_ROOT, target.migrationDatabaseUrl);
  partial.checks.migrationIdempotency = idempotency.pass ? "PASS" : "FAIL";
  if (!idempotency.pass) throw fail(EXIT.VALIDATION, "validation", "migration deploy was not idempotent against restored target");

  const validationCompletedAt = new Date();
  const rtoMs = validationCompletedAt.getTime() - restoreStartedAt.getTime();
  partial.rpoMs = rpoMs;
  partial.rtoMs = rtoMs;
  partial.checks.rpo = rpoMs <= RPO_THRESHOLD_MS ? "PASS" : "FAIL";
  partial.checks.rto = rtoMs <= RTO_THRESHOLD_MS ? "PASS" : "FAIL";
  if (partial.checks.rpo !== "PASS") throw fail(EXIT.VALIDATION, "validation", `RPO ${rpoMs}ms exceeded provisional threshold`);
  if (partial.checks.rto !== "PASS") throw fail(EXIT.VALIDATION, "validation", `RTO ${rtoMs}ms exceeded provisional threshold`);

  writeValidationReport(args.evidenceDir, {
    schema: schemaComparison.match, table: tableComparison.match, sequence: sequenceComparison.match,
    constraint: constraintComparison.match, migrationIdempotency: idempotency.pass, rpoMs, rtoMs,
  });
}

function buildReceipt({ args, partial, result, exitCode, primaryFailureCode, cleanup }) {
  return {
    schemaVersion: 1,
    unit: "U009",
    runId: args.runId,
    lifecycleProvider: "scripts/lib/isolated-postgres.mjs#withIsolatedPostgresPair",
    imageDigest: args.imageDigest,
    postgresMajor: 16,
    fixtureSha256: partial.fixtureSha256 ?? "0".repeat(64),
    exitCode,
    result,
    ...(args.failureScenario ? { failureScenario: args.failureScenario } : {}),
    ...(result === "FAIL" ? { primaryFailureCode: primaryFailureCode ?? exitCode, failureStage: STAGE_FOR_EXIT[primaryFailureCode ?? exitCode] ?? "backup" } : {}),
    sourceSentinelMatch: partial.sourceSentinelMatch ?? false,
    targetSentinelMatch: partial.targetSentinelMatch ?? false,
    checks: partial.checks,
    rpo: { measuredMs: partial.rpoMs ?? 0, thresholdMs: RPO_THRESHOLD_MS, provisional: true, status: partial.checks.rpo },
    rto: { measuredMs: partial.rtoMs ?? 0, thresholdMs: RTO_THRESHOLD_MS, provisional: true, status: partial.checks.rto },
    cleanup,
    createdAt: new Date().toISOString(),
  };
}

function refuseAmbientDatabaseUrl() {
  if (typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0) {
    throw fail(EXIT.CONFIG, "config", "restore-drill: ambient DATABASE_URL must not be set; the fixture DSN is generated internally");
  }
}

const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };

class AbortedBySignal extends Error {
  constructor(signal) {
    super(`restore-drill: aborted by ${signal}`);
    this.signal = signal;
    this.signalExit = SIGNAL_EXIT[signal] ?? 143;
  }
}

export async function restoreDrillMain(argv = process.argv.slice(2)) {
  let args;
  try {
    refuseAmbientDatabaseUrl();
    args = parseRestoreDrillArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error.exitCode ?? EXIT.CONFIG;
  }

  mkdirSync(args.evidenceDir, { recursive: true });

  const partial = { checks: { ...EMPTY_CHECKS } };
  let primaryFailureCode;
  let caughtError;
  let receivedSignal = null;
  const onSignal = (signal) => { receivedSignal = signal; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const checkAborted = () => {
    if (receivedSignal) throw new AbortedBySignal(receivedSignal);
  };

  try {
    await withIsolatedPostgresPair(
      { runId: args.runId, ownerUnit: "U009", purpose: PURPOSE, evidenceDir: args.evidenceDir, imageDigest: args.imageDigest, migrate: false },
      async ({ primary, secondary }) => {
        try {
          await runDrillBody({ primary, secondary, args, partial, checkAborted });
        } catch (error) {
          if (!(error instanceof AbortedBySignal)) primaryFailureCode = error.exitCode ?? EXIT.BACKUP;
          throw error;
        }
      },
    );
  } catch (error) {
    caughtError = error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  const cleanup = {
    source: await labelResourceCounts(args.runId, "-a"),
    target: await labelResourceCounts(args.runId, "-b"),
  };
  writeFileSync(join(args.evidenceDir, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (caughtError instanceof AbortedBySignal) {
    process.stderr.write(`${caughtError.message}\n`);
    return caughtError.signalExit;
  }

  if (caughtError) {
    const exitCode = typeof caughtError.exitCode === "number" ? caughtError.exitCode : (primaryFailureCode ?? EXIT.BACKUP);
    const receipt = buildReceipt({ args, partial, result: "FAIL", exitCode, primaryFailureCode, cleanup });
    try {
      validateAgainstSchemaFile(RECEIPT_SCHEMA_PATH, receipt);
      atomicWriteJson(join(args.evidenceDir, "receipt.json"), receipt);
    } catch {
      // Receipt authoring is best-effort on the failure path; the process
      // exit code remains the authoritative failure signal for callers.
    }
    process.stderr.write(`${caughtError.message ?? caughtError}\n`);
    return exitCode;
  }

  const receipt = buildReceipt({ args, partial, result: "PASS", exitCode: EXIT.SUCCESS, cleanup });
  validateAgainstSchemaFile(RECEIPT_SCHEMA_PATH, receipt);
  atomicWriteJson(join(args.evidenceDir, "receipt.json"), receipt);
  return EXIT.SUCCESS;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  restoreDrillMain().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exit(65);
    },
  );
}
