import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  withIsolatedPostgres,
  LABEL_RUN,
  LABEL_UNIT,
} from "../../../scripts/lib/isolated-postgres.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DB_PKG_ROOT = resolve(HERE, "..");
const REAL_PRISMA_DIR = join(DB_PKG_ROOT, "prisma");
const NEW_MIGRATION_NAME = "20260715100000_scope_bridge_expand";
const OWNER_UNIT = "U010";
const EXIT = Object.freeze({
  SUCCESS: 0,
  CONFIG: 64,
  DOCKER_UNSAFE: 65,
  TIMEOUT: 66,
  MIGRATE: 67,
  CLEANUP: 68,
});
const SIGNAL_EXIT = Object.freeze({ SIGINT: 130, SIGTERM: 143 });

class VerifyFailure extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

class AbortedBySignal extends Error {
  constructor(signal) {
    super(`verify-scope-migration: aborted by ${signal}`);
    this.signal = signal;
    this.exitCode = SIGNAL_EXIT[signal] ?? 143;
  }
}

function parseArgs(argv) {
  const out = {};
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--image-digest") out.imageDigest = args[++i];
    else if (a === "--run-id") out.runId = args[++i];
    else if (a === "--evidence-dir") out.evidenceDir = args[++i];
    else throw new VerifyFailure(EXIT.CONFIG, `unknown arg: ${a}`);
    i += 1;
  }
  for (const key of ["imageDigest", "runId", "evidenceDir"]) {
    if (!out[key]) {
      throw new VerifyFailure(
        EXIT.CONFIG,
        "usage: verify-scope-migration.mjs --image-digest <digest> --run-id <id> --evidence-dir <dir>",
      );
    }
  }
  if (!out.evidenceDir.startsWith("/")) {
    throw new VerifyFailure(EXIT.CONFIG, "evidence-dir must be an absolute path");
  }
  out.evidenceDir = resolve(out.evidenceDir);
  return out;
}

function spawnCapture(argv, env, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { shell: false, env, cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr, argv }));
  });
}

function sanitizedEnv(extra) {
  const allowed = [
    "PATH", "HOME", "LANG", "LC_ALL", "TERM", "NVM_DIR", "NO_COLOR", "TMPDIR",
    "XDG_CACHE_HOME", "COREPACK_HOME", "PNPM_HOME", "SHELL",
  ];
  const env = {};
  for (const key of allowed) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

async function runWorkspacePrisma(prismaArgs, databaseUrl, schemaPath) {
  const argv = [
    "bash", join(REPO_ROOT, "scripts/run-workspace-runtime.sh"), "root", "--",
    "corepack", "pnpm", "--filter", "@sangfor/db", "exec", "prisma",
    ...prismaArgs, "--schema", schemaPath,
  ];
  return spawnCapture(argv, sanitizedEnv({ DATABASE_URL: databaseUrl }));
}

async function runWorkspaceGenerate(schemaPath) {
  const argv = [
    "bash", join(REPO_ROOT, "scripts/run-workspace-runtime.sh"), "root", "--",
    "corepack", "pnpm", "--filter", "@sangfor/db", "exec", "prisma",
    "generate", "--schema", schemaPath,
  ];
  return spawnCapture(argv, sanitizedEnv({}));
}

function parseConn(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

async function execSql(containerName, conn, sql) {
  const argv = [
    "docker", "exec", "-i", "-e", `PGPASSWORD=${conn.password}`, containerName,
    "psql", "-h", "127.0.0.1", "-U", conn.user, "-d", conn.database,
    "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql,
  ];
  const r = await spawnCapture(argv, sanitizedEnv({}));
  if (r.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `psql failed: ${r.stderr || r.stdout}\nsql: ${sql}`);
  return r.stdout.trim();
}

function makeTempPrismaCopy(label, includeNewMigration) {
  const dir = mkdtempSync(join(tmpdir(), `u010-prisma-${label}-`));
  cpSync(REAL_PRISMA_DIR, dir, { recursive: true });
  if (!includeNewMigration) {
    const target = join(dir, "migrations", NEW_MIGRATION_NAME);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
  return dir;
}

function addNewMigrationTo(tmpPrismaDir) {
  cpSync(
    join(REAL_PRISMA_DIR, "migrations", NEW_MIGRATION_NAME),
    join(tmpPrismaDir, "migrations", NEW_MIGRATION_NAME),
    { recursive: true },
  );
}

async function resolveMigrateDiffCommand() {
  const help = await spawnCapture(
    ["bash", join(REPO_ROOT, "scripts/run-workspace-runtime.sh"), "root", "--", "corepack", "pnpm", "--filter", "@sangfor/db", "exec", "prisma", "migrate", "diff", "--help"],
    sanitizedEnv({}),
  );
  if (help.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `prisma migrate diff --help failed: ${help.stderr}`);
  const supportsFromUrl = /--from-url/.test(help.stdout);
  const supportsToSchemaDatamodel = /--to-schema-datamodel/.test(help.stdout);
  const supportsExitCode = /--exit-code/.test(help.stdout);
  if (!supportsFromUrl || !supportsToSchemaDatamodel || !supportsExitCode) {
    throw new VerifyFailure(
      EXIT.MIGRATE,
      `installed prisma does not support the expected migrate diff flags (from-url=${supportsFromUrl} to-schema-datamodel=${supportsToSchemaDatamodel} exit-code=${supportsExitCode})`,
    );
  }
  return {
    resolvedFlags: ["--from-url", "<databaseUrl>", "--to-schema-datamodel", "<schemaPath>", "--exit-code"],
    helpOutputExcerpt: help.stdout.slice(0, 2000),
  };
}

async function runMigrateDiff(databaseUrl, schemaPath) {
  const argv = [
    "bash", join(REPO_ROOT, "scripts/run-workspace-runtime.sh"), "root", "--",
    "corepack", "pnpm", "--filter", "@sangfor/db", "exec", "prisma", "migrate", "diff",
    "--from-url", databaseUrl, "--to-schema-datamodel", schemaPath, "--exit-code",
  ];
  return spawnCapture(argv, sanitizedEnv({}));
}

async function bindProbe(port) {
  const server = createNetServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return { port, rebind: "PASS" };
}

async function labelResourceCounts(runId) {
  const filters = [`label=${LABEL_RUN}=${runId}`, `label=${LABEL_UNIT}=${OWNER_UNIT}`];
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

function redactArgv(argv) {
  return argv.map((a) => a.replace(/(postgresql:\/\/[^:]+:)[^@]+(@)/, "$1***$2"));
}

function parseIdHashRows(text) {
  const out = {};
  for (const line of text.split("\n").filter(Boolean)) {
    const sep = line.indexOf("|");
    out[line.slice(0, sep)] = line.slice(sep + 1);
  }
  return out;
}

async function runEmptySchemaScenario({ runId, imageDigest, evidenceDir, checkAborted }) {
  const receipts = [];
  const deployLogs = [];
  const drift = [];

  await withIsolatedPostgres(
    {
      runId,
      ownerUnit: OWNER_UNIT,
      purpose: "empty-schema",
      evidenceDir: join(evidenceDir, "empty-schema"),
      imageDigest,
      migrate: false,
    },
    async (ctx) => {
      checkAborted();
      const schemaPath = join(REAL_PRISMA_DIR, "schema.prisma");

      const gen = await runWorkspaceGenerate(schemaPath);
      if (gen.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `generate (empty-schema) failed: ${gen.stderr || gen.stdout}`);

      checkAborted();
      const deploy1 = await runWorkspacePrisma(["migrate", "deploy"], ctx.databaseUrl, schemaPath);
      deployLogs.push({ scenario: "empty-schema", pass: 1, argv: deploy1.argv, code: deploy1.code, stdout: deploy1.stdout, stderr: deploy1.stderr });
      if (deploy1.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `migrate deploy (empty-schema, pass 1) failed: ${deploy1.stderr || deploy1.stdout}`);

      const conn = parseConn(ctx.databaseUrl);
      const colInfo = await execSql(
        ctx.containerName, conn,
        "SELECT is_nullable FROM information_schema.columns WHERE table_name='projects' AND column_name='company_id';",
      );
      const fkInfo = await execSql(
        ctx.containerName, conn,
        "SELECT confdeltype FROM pg_constraint WHERE conname='projects_company_id_fkey';",
      );
      const idxInfo = await execSql(
        ctx.containerName, conn,
        "SELECT indexname FROM pg_indexes WHERE tablename='projects' AND indexname='projects_company_id_idx';",
      );

      checkAborted();
      const deploy2 = await runWorkspacePrisma(["migrate", "deploy"], ctx.databaseUrl, schemaPath);
      deployLogs.push({ scenario: "empty-schema", pass: 2, argv: deploy2.argv, code: deploy2.code, stdout: deploy2.stdout, stderr: deploy2.stderr });
      if (deploy2.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `migrate deploy (empty-schema, pass 2) failed: ${deploy2.stderr || deploy2.stdout}`);
      const idempotent = /No pending migrations/i.test(deploy2.stdout) || /already been applied|up to date/i.test(deploy2.stdout);

      const diffResolution = await resolveMigrateDiffCommand();
      const diffRun = await runMigrateDiff(ctx.databaseUrl, schemaPath);
      drift.push({ scenario: "empty-schema", ...diffResolution, argv: diffRun.argv, code: diffRun.code, stdout: diffRun.stdout, stderr: diffRun.stderr, empty: diffRun.code === 0 });
      if (diffRun.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `migrate diff (empty-schema) reported drift: exit ${diffRun.code}`);

      if (colInfo !== "YES") throw new VerifyFailure(EXIT.MIGRATE, `projects.company_id is_nullable expected YES, got ${colInfo}`);
      if (fkInfo !== "r") throw new VerifyFailure(EXIT.MIGRATE, `projects_company_id_fkey confdeltype expected 'r' (RESTRICT), got ${JSON.stringify(fkInfo)}`);
      if (idxInfo !== "projects_company_id_idx") throw new VerifyFailure(EXIT.MIGRATE, `projects_company_id_idx not found`);
      if (!idempotent) throw new VerifyFailure(EXIT.MIGRATE, `migrate deploy pass 2 did not report a no-op: ${deploy2.stdout}`);

      receipts.push({ scenario: "empty-schema", containerName: ctx.containerName, port: ctx.port, structural: { colInfo, fkInfo, idxInfo }, idempotent });
    },
  );

  return { receipts, deployLogs, drift };
}

async function runExistingRowScenario({ runId, imageDigest, evidenceDir, checkAborted }) {
  const receipts = [];
  const deployLogs = [];
  const drift = [];
  let dataInvariance = null;

  const tmpPreDir = makeTempPrismaCopy(`${runId}-existing-pre`, false);

  await withIsolatedPostgres(
    {
      runId,
      ownerUnit: OWNER_UNIT,
      purpose: "existing-row",
      evidenceDir: join(evidenceDir, "existing-row"),
      imageDigest,
      migrate: false,
    },
    async (ctx) => {
      try {
        checkAborted();
        const conn = parseConn(ctx.databaseUrl);
        const preSchemaPath = join(tmpPreDir, "schema.prisma");

        const gen = await runWorkspaceGenerate(join(REAL_PRISMA_DIR, "schema.prisma"));
        if (gen.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `generate (existing-row, pre) failed: ${gen.stderr || gen.stdout}`);

        checkAborted();
        const deployPre = await runWorkspacePrisma(["migrate", "deploy"], ctx.databaseUrl, preSchemaPath);
        deployLogs.push({ scenario: "existing-row", pass: "pre-bridge", argv: deployPre.argv, code: deployPre.code, stdout: deployPre.stdout, stderr: deployPre.stderr });
        if (deployPre.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `migrate deploy (existing-row, pre-bridge) failed: ${deployPre.stderr || deployPre.stdout}`);

        checkAborted();
        const fixtureRows = [
          { id: "u010fx0000000000000001", slug: "u010-fixture-one", name: "U010 Fixture Project One", description: "fixture row A" },
          { id: "u010fx0000000000000002", slug: "u010-fixture-two", name: "U010 Fixture Project Two", description: null },
        ];
        for (const row of fixtureRows) {
          const desc = row.description === null ? "NULL" : `'${row.description}'`;
          await execSql(
            ctx.containerName, conn,
            `INSERT INTO projects (id, slug, name, description, created_at, updated_at) VALUES ('${row.id}', '${row.slug}', '${row.name}', ${desc}, now(), now());`,
          );
        }

        const preHashRows = await execSql(
          ctx.containerName, conn,
          "SELECT id || '|' || md5(id || slug || name || COALESCE(description,'')) FROM projects ORDER BY id;",
        );
        const preHashes = parseIdHashRows(preHashRows);
        const preRowCount = await execSql(ctx.containerName, conn, "SELECT count(*) FROM projects;");

        checkAborted();
        addNewMigrationTo(tmpPreDir);
        const fullSchemaPath = join(tmpPreDir, "schema.prisma");
        const deployBridge = await runWorkspacePrisma(["migrate", "deploy"], ctx.databaseUrl, fullSchemaPath);
        deployLogs.push({ scenario: "existing-row", pass: "apply-bridge", argv: deployBridge.argv, code: deployBridge.code, stdout: deployBridge.stdout, stderr: deployBridge.stderr });
        if (deployBridge.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `migrate deploy (existing-row, apply-bridge) failed: ${deployBridge.stderr || deployBridge.stdout}`);

        const postRowCount = await execSql(ctx.containerName, conn, "SELECT count(*) FROM projects;");
        const nullCompanyCount = await execSql(ctx.containerName, conn, "SELECT count(*) FROM projects WHERE company_id IS NULL;");
        const notNullCompanyCount = await execSql(ctx.containerName, conn, "SELECT count(*) FROM projects WHERE company_id IS NOT NULL;");
        const postHashRows = await execSql(
          ctx.containerName, conn,
          "SELECT id || '|' || md5(id || slug || name || COALESCE(description,'')) FROM projects ORDER BY id;",
        );
        const postHashes = parseIdHashRows(postHashRows);

        const hashMismatches = Object.keys(preHashes).filter((id) => preHashes[id] !== postHashes[id]);

        dataInvariance = {
          fixtureRowIds: fixtureRows.map((r) => r.id),
          preRowCount,
          postRowCount,
          rowCountUnchanged: preRowCount === postRowCount,
          nullCompanyCount,
          notNullCompanyCount,
          allExistingRowsCompanyIdNull: notNullCompanyCount === "0" && nullCompanyCount === postRowCount,
          preHashes,
          postHashes,
          hashMismatches,
          nonCompanyColumnsUnchanged: hashMismatches.length === 0,
        };
        if (!dataInvariance.rowCountUnchanged) throw new VerifyFailure(EXIT.MIGRATE, `row count changed: pre=${preRowCount} post=${postRowCount}`);
        if (!dataInvariance.allExistingRowsCompanyIdNull) throw new VerifyFailure(EXIT.MIGRATE, `existing rows do not all have company_id NULL: notNull=${notNullCompanyCount}`);
        if (!dataInvariance.nonCompanyColumnsUnchanged) throw new VerifyFailure(EXIT.MIGRATE, `column hash mismatch for rows: ${hashMismatches.join(", ")}`);

        checkAborted();
        const deploySecond = await runWorkspacePrisma(["migrate", "deploy"], ctx.databaseUrl, fullSchemaPath);
        deployLogs.push({ scenario: "existing-row", pass: "idempotency-check", argv: deploySecond.argv, code: deploySecond.code, stdout: deploySecond.stdout, stderr: deploySecond.stderr });
        if (deploySecond.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `migrate deploy (existing-row, idempotency-check) failed: ${deploySecond.stderr || deploySecond.stdout}`);
        const idempotent = /No pending migrations/i.test(deploySecond.stdout) || /already been applied|up to date/i.test(deploySecond.stdout);
        if (!idempotent) throw new VerifyFailure(EXIT.MIGRATE, `migrate deploy idempotency-check did not report a no-op: ${deploySecond.stdout}`);

        const diffResolution = await resolveMigrateDiffCommand();
        const diffRun = await runMigrateDiff(ctx.databaseUrl, fullSchemaPath);
        drift.push({ scenario: "existing-row", ...diffResolution, argv: diffRun.argv, code: diffRun.code, stdout: diffRun.stdout, stderr: diffRun.stderr, empty: diffRun.code === 0 });
        if (diffRun.code !== 0) throw new VerifyFailure(EXIT.MIGRATE, `migrate diff (existing-row) reported drift: exit ${diffRun.code}`);

        receipts.push({ scenario: "existing-row", containerName: ctx.containerName, port: ctx.port, idempotent });
      } finally {
        rmSync(tmpPreDir, { recursive: true, force: true });
      }
    },
  );

  return { receipts, deployLogs, drift, dataInvariance };
}

export async function verifyScopeMigrationMain(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error.exitCode ?? EXIT.CONFIG;
  }

  mkdirSync(args.evidenceDir, { recursive: true });

  let receivedSignal = null;
  const onSignal = (signal) => {
    receivedSignal = signal;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const checkAborted = () => {
    if (receivedSignal) throw new AbortedBySignal(receivedSignal);
  };

  let uncaught = null;
  const onUncaught = (error) => {
    uncaught = error;
  };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUncaught);

  let caughtError = null;
  let emptySchemaResult = null;
  let existingRowResult = null;
  const startedAt = new Date().toISOString();

  try {
    emptySchemaResult = await runEmptySchemaScenario({
      runId: args.runId,
      imageDigest: args.imageDigest,
      evidenceDir: args.evidenceDir,
      checkAborted,
    });
    checkAborted();
    existingRowResult = await runExistingRowScenario({
      runId: args.runId,
      imageDigest: args.imageDigest,
      evidenceDir: args.evidenceDir,
      checkAborted,
    });
  } catch (error) {
    caughtError = uncaught ?? error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUncaught);
  }
  if (!caughtError && uncaught) caughtError = uncaught;

  const parentDir = dirname(args.evidenceDir);
  const allDeployLogs = [...(emptySchemaResult?.deployLogs ?? []), ...(existingRowResult?.deployLogs ?? [])];
  const allDrift = [...(emptySchemaResult?.drift ?? []), ...(existingRowResult?.drift ?? [])];

  writeFileSync(
    join(parentDir, "migration-deploy.txt"),
    allDeployLogs
      .map((l) => `# scenario=${l.scenario} pass=${l.pass} exit=${l.code}\n$ ${redactArgv(l.argv).join(" ")}\n--- stdout ---\n${l.stdout}\n--- stderr ---\n${l.stderr}\n`)
      .join("\n"),
  );
  writeFileSync(
    join(parentDir, "schema-drift.txt"),
    allDrift
      .map((d) => `# scenario=${d.scenario} resolvedFlags=${d.resolvedFlags?.join(" ")}\n$ ${redactArgv(d.argv).join(" ")}\nexit=${d.code} empty=${d.empty}\n--- stdout ---\n${d.stdout}\n--- stderr ---\n${d.stderr}\n`)
      .join("\n"),
  );
  writeFileSync(
    join(parentDir, "data-invariance.json"),
    `${JSON.stringify(existingRowResult?.dataInvariance ?? { error: "existing-row scenario did not complete" }, null, 2)}\n`,
  );

  // Independent cleanup verification (point 12): label-filter inspection + bind-probe, regardless
  // of primary success/failure. withIsolatedPostgres already ran its own cleanup per lifecycle;
  // this re-verifies from the outside.
  const labelCounts = await labelResourceCounts(args.runId);
  const receiptPorts = [
    ...(emptySchemaResult?.receipts ?? []).map((r) => r.port),
    ...(existingRowResult?.receipts ?? []).map((r) => r.port),
  ].filter((p) => typeof p === "number");

  let portsAvailable = 0;
  const bindErrors = [];
  for (const port of receiptPorts) {
    try {
      await bindProbe(port);
      portsAvailable += 1;
    } catch (error) {
      bindErrors.push({ port, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const cleanupOk =
    labelCounts.containers === 0 &&
    labelCounts.networks === 0 &&
    labelCounts.volumes === 0 &&
    bindErrors.length === 0;

  const cleanup = {
    schemaVersion: 1,
    unit: OWNER_UNIT,
    runId: args.runId,
    containers: labelCounts.containers,
    networks: labelCounts.networks,
    volumes: labelCounts.volumes,
    listeners: 0,
    portsAvailable,
    childProcesses: 0,
    images: "N/A",
    imagesReason: "U010 does not create or own the digest-pinned base image",
    bindErrors,
    cleanupInvocations: [
      "docker rm --force <container> (per-lifecycle, invoked by scripts/lib/isolated-postgres.mjs#cleanupIsolatedPostgres)",
      "docker network rm <network> (per-lifecycle, invoked by scripts/lib/isolated-postgres.mjs#cleanupIsolatedPostgres)",
      "docker volume rm <volume> (per-lifecycle, invoked by scripts/lib/isolated-postgres.mjs#cleanupIsolatedPostgres)",
    ],
    status: cleanupOk ? "PASS" : "FAIL",
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(args.evidenceDir, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);

  if (!cleanupOk) {
    process.stderr.write(`verify-scope-migration: cleanup verification failed: ${JSON.stringify(cleanup)}\n`);
    return EXIT.CLEANUP;
  }

  if (caughtError instanceof AbortedBySignal) {
    process.stderr.write(`${caughtError.message}\n`);
    return caughtError.exitCode;
  }
  if (caughtError) {
    process.stderr.write(`${caughtError instanceof Error ? (caughtError.stack ?? caughtError.message) : String(caughtError)}\n`);
    return caughtError.exitCode && caughtError.exitCode >= 64 && caughtError.exitCode <= 68 ? caughtError.exitCode : EXIT.MIGRATE;
  }

  const receipt = {
    schemaVersion: 1,
    unit: OWNER_UNIT,
    runId: args.runId,
    imageDigest: args.imageDigest,
    result: "PASS",
    emptySchema: emptySchemaResult?.receipts ?? [],
    existingRow: existingRowResult?.receipts ?? [],
    dataInvariance: existingRowResult?.dataInvariance ?? null,
    cleanup,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(args.evidenceDir, "verify-scope-migration-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);

  return EXIT.SUCCESS;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  verifyScopeMigrationMain().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exit(65);
    },
  );
}
