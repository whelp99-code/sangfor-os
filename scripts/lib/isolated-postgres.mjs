/**
 * U007 — generic task-owned scratch PostgreSQL lifecycle.
 * Exports: withIsolatedPostgres, withIsolatedPostgresPair, assertSafeLocalDocker, cleanupIsolatedPostgres
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import net from "node:net";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const DEFAULT_LOCK = join(
  REPO_ROOT,
  "scripts/fixtures/restore-drill/postgres16-image.lock.json",
);

const LABEL_RUN = "com.sangfor.refactor.run";
const LABEL_UNIT = "com.sangfor.refactor.unit";
const LABEL_PURPOSE = "com.sangfor.refactor.purpose";

function fail(code, message) {
  const err = new Error(message);
  err.exitCode = code;
  throw err;
}

/**
 * @param {string[]} argv
 * @param {{env?: NodeJS.ProcessEnv, cwd?: string, input?: string}} [opts]
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function spawnFile(argv, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      shell: false,
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    if (opts.input) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        resolvePromise({ code: 128 + signalToNumber(signal), stdout, stderr });
      } else {
        resolvePromise({ code: code ?? 1, stdout, stderr });
      }
    });
  });
}

function signalToNumber(signal) {
  const map = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1, SIGKILL: 9 };
  return map[signal] ?? 15;
}

/**
 * @param {unknown} options
 */
function validateOptions(options) {
  if (!options || typeof options !== "object") {
    fail(64, "isolated-postgres: options required");
  }
  const allowed = new Set([
    "runId",
    "ownerUnit",
    "purpose",
    "evidenceDir",
    "imageDigest",
    "migrate",
    "applicationRoleMode",
    "lockPath",
    "repoRoot",
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      fail(64, `isolated-postgres: unknown option ${key}`);
    }
  }
  const {
    runId,
    ownerUnit,
    purpose,
    evidenceDir,
    imageDigest,
    migrate,
    applicationRoleMode,
  } = options;
  for (const [k, v] of [
    ["runId", runId],
    ["ownerUnit", ownerUnit],
    ["purpose", purpose],
    ["evidenceDir", evidenceDir],
    ["imageDigest", imageDigest],
  ]) {
    if (typeof v !== "string" || v.length === 0) {
      fail(64, `isolated-postgres: ${k} required string`);
    }
  }
  if (migrate !== undefined && typeof migrate !== "boolean") {
    fail(64, 'isolated-postgres: migrate must be boolean true|false');
  }
  if (
    applicationRoleMode !== undefined &&
    applicationRoleMode !== "none" &&
    applicationRoleMode !== "required"
  ) {
    fail(64, 'isolated-postgres: applicationRoleMode must be "none"|"required"');
  }
  if (imageDigest && !/^sha256:[0-9a-f]{64}$/.test(imageDigest)) {
    fail(64, "isolated-postgres: imageDigest must be sha256:<64hex>");
  }
  return {
    runId,
    ownerUnit,
    purpose,
    evidenceDir: resolve(evidenceDir),
    imageDigest,
    migrate: migrate === true,
    applicationRoleMode: applicationRoleMode ?? "none",
    lockPath: options.lockPath ?? DEFAULT_LOCK,
    repoRoot: options.repoRoot ?? REPO_ROOT,
  };
}

/**
 * @param {{imageDigest: string, lockPath: string}} opts
 */
export function loadAndMatchImageLock({ imageDigest, lockPath }) {
  const raw = readFileSync(lockPath, "utf8");
  const lock = JSON.parse(raw);
  const required = [
    "repository",
    "sourceTag",
    "major",
    "manifestListDigest",
    "resolvedImage",
  ];
  for (const k of required) {
    if (!(k in lock)) fail(64, `postgres lock missing ${k}`);
  }
  for (const k of Object.keys(lock)) {
    if (!required.includes(k)) fail(64, `postgres lock unknown field ${k}`);
  }
  if (lock.repository !== "docker.io/library/postgres") {
    fail(64, "postgres lock repository mismatch");
  }
  if (lock.sourceTag !== "16-alpine") fail(64, "postgres lock sourceTag mismatch");
  if (lock.major !== 16) fail(64, "postgres lock major mismatch");
  if (!/^sha256:[0-9a-f]{64}$/.test(lock.manifestListDigest)) {
    fail(64, "postgres lock digest format");
  }
  if (lock.resolvedImage !== `docker.io/library/postgres@${lock.manifestListDigest}`) {
    fail(64, "postgres lock resolvedImage mismatch");
  }
  if (imageDigest !== lock.manifestListDigest) {
    fail(64, "isolated-postgres: imageDigest does not match lock");
  }
  return lock;
}

/**
 * @param {{}} [options]
 */
export async function assertSafeLocalDocker(options = {}) {
  if (process.env.DOCKER_HOST) {
    fail(64, "isolated-postgres: DOCKER_HOST must not be set");
  }
  if (process.env.DOCKER_CONTEXT) {
    fail(64, "isolated-postgres: DOCKER_CONTEXT must not be set");
  }
  if (process.env.DATABASE_URL && options.allowCallerDatabaseUrl !== true) {
    // Caller ambient DATABASE_URL is forbidden at resource creation time.
    fail(64, "isolated-postgres: caller DATABASE_URL must not be set");
  }

  const ctx = await spawnFile(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
  if (ctx.code !== 0) {
    fail(64, `isolated-postgres: docker context inspect failed: ${ctx.stderr}`);
  }
  const host = ctx.stdout.trim();
  if (!host.startsWith("unix://")) {
    fail(64, `isolated-postgres: docker host must be unix://, got ${host}`);
  }
  return { dockerHost: host };
}

function sanitizeRunId(runId) {
  return runId.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase().slice(0, 48);
}

function randomSecret(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

/**
 * @param {object} opts
 */
async function dockerLabelCount({ runId, ownerUnit, purpose }) {
  const filter = [
    `label=${LABEL_RUN}=${runId}`,
    `label=${LABEL_UNIT}=${ownerUnit}`,
    `label=${LABEL_PURPOSE}=${purpose}`,
  ];
  let total = 0;
  for (const kind of ["container", "network", "volume"]) {
    const argv =
      kind === "container"
        ? ["docker", "ps", "-aq", ...filter.flatMap((f) => ["--filter", f])]
        : kind === "network"
          ? ["docker", "network", "ls", "-q", ...filter.flatMap((f) => ["--filter", f])]
          : ["docker", "volume", "ls", "-q", ...filter.flatMap((f) => ["--filter", f])];
    const r = await spawnFile(argv);
    if (r.stdout.trim()) {
      total += r.stdout.trim().split("\n").filter(Boolean).length;
    }
  }
  return total;
}

/**
 * @param {object} state
 */
export async function cleanupIsolatedPostgres(state) {
  const {
    runId,
    ownerUnit,
    purpose,
    containerName,
    networkName,
    volumeName,
    evidenceDir,
  } = state;

  const errors = [];
  if (containerName) {
    const r = await spawnFile(["docker", "rm", "-f", containerName]);
    if (r.code !== 0 && !/No such container/i.test(r.stderr)) {
      errors.push(`container: ${r.stderr}`);
    }
  }
  if (networkName) {
    const r = await spawnFile(["docker", "network", "rm", networkName]);
    if (r.code !== 0 && !/not found|No such/i.test(r.stderr + r.stdout)) {
      errors.push(`network: ${r.stderr}`);
    }
  }
  if (volumeName) {
    const r = await spawnFile(["docker", "volume", "rm", "-f", volumeName]);
    if (r.code !== 0 && !/no such|not found/i.test(r.stderr + r.stdout)) {
      errors.push(`volume: ${r.stderr}`);
    }
  }

  // Also sweep by labels in case names drifted
  const listed = await spawnFile([
    "docker",
    "ps",
    "-aq",
    "--filter",
    `label=${LABEL_RUN}=${runId}`,
    "--filter",
    `label=${LABEL_UNIT}=${ownerUnit}`,
    "--filter",
    `label=${LABEL_PURPOSE}=${purpose}`,
  ]);
  for (const id of listed.stdout.trim().split("\n").filter(Boolean)) {
    await spawnFile(["docker", "rm", "-f", id]);
  }

  const remaining = await dockerLabelCount({ runId, ownerUnit, purpose });
  const cleanup = {
    remainingLabelCount: remaining,
    errors,
    status: remaining === 0 && errors.length === 0 ? "PASS" : "FAIL",
  };
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      join(evidenceDir, "postgres-cleanup.json"),
      JSON.stringify(cleanup, null, 2),
    );
  }
  if (cleanup.status !== "PASS") {
    const err = new Error(`isolated-postgres cleanup failed: ${JSON.stringify(cleanup)}`);
    err.exitCode = 68;
    throw err;
  }
  return cleanup;
}

async function waitForPort(host, port, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((res) => {
      const s = net.connect({ host, port }, () => {
        s.end();
        res(true);
      });
      s.on("error", () => res(false));
    });
    if (ok) return;
    await sleep(250);
  }
  fail(66, `isolated-postgres: timeout waiting for ${host}:${port}`);
}

async function execSql(containerName, user, password, database, sql) {
  // Use TCP inside the container — unix socket path is not always ready
  // immediately after pg_isready on alpine images.
  const r = await spawnFile([
    "docker",
    "exec",
    "-i",
    "-e",
    `PGPASSWORD=${password}`,
    containerName,
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    user,
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
    "-c",
    sql,
  ]);
  if (r.code !== 0) {
    fail(66, `psql failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

/**
 * @param {object} rawOptions
 * @param {(ctx: object) => Promise<unknown>} callback
 */
export async function withIsolatedPostgres(rawOptions, callback) {
  const options = validateOptions(rawOptions);
  if (typeof callback !== "function") {
    fail(64, "isolated-postgres: callback required");
  }

  await assertSafeLocalDocker({});
  const lock = loadAndMatchImageLock({
    imageDigest: options.imageDigest,
    lockPath: options.lockPath,
  });

  mkdirSync(options.evidenceDir, { recursive: true });

  const sanitized = sanitizeRunId(options.runId);
  const adminUser = `u_${randomSecret(6)}`;
  const adminPassword = randomSecret(24);
  const databaseName = `sangfor_task_${sanitized}`;
  const token = randomSecret(8).toLowerCase();
  const containerName = `sangfor-pg-${sanitized}-${token}`.slice(0, 63);
  const networkName = `sangfor-net-${sanitized}-${token}`.slice(0, 63);
  const volumeName = `sangfor-vol-${sanitized}-${token}`.slice(0, 63);

  const state = {
    runId: options.runId,
    ownerUnit: options.ownerUnit,
    purpose: options.purpose,
    containerName,
    networkName,
    volumeName,
    evidenceDir: options.evidenceDir,
  };

  /** @type {object|null} */
  let receipt = null;
  let hostPort = null;

  try {
    const netCreate = await spawnFile([
      "docker",
      "network",
      "create",
      "--label",
      `${LABEL_RUN}=${options.runId}`,
      "--label",
      `${LABEL_UNIT}=${options.ownerUnit}`,
      "--label",
      `${LABEL_PURPOSE}=${options.purpose}`,
      networkName,
    ]);
    if (netCreate.code !== 0) {
      fail(65, `network create failed: ${netCreate.stderr}`);
    }

    const volCreate = await spawnFile([
      "docker",
      "volume",
      "create",
      "--label",
      `${LABEL_RUN}=${options.runId}`,
      "--label",
      `${LABEL_UNIT}=${options.ownerUnit}`,
      "--label",
      `${LABEL_PURPOSE}=${options.purpose}`,
      volumeName,
    ]);
    if (volCreate.code !== 0) {
      fail(65, `volume create failed: ${volCreate.stderr}`);
    }

    const run = await spawnFile([
      "docker",
      "run",
      "-d",
      "--name",
      containerName,
      "--network",
      networkName,
      "--label",
      `${LABEL_RUN}=${options.runId}`,
      "--label",
      `${LABEL_UNIT}=${options.ownerUnit}`,
      "--label",
      `${LABEL_PURPOSE}=${options.purpose}`,
      "-e",
      `POSTGRES_USER=${adminUser}`,
      "-e",
      `POSTGRES_PASSWORD=${adminPassword}`,
      "-e",
      `POSTGRES_DB=${databaseName}`,
      "-p",
      "127.0.0.1::5432",
      "-v",
      `${volumeName}:/var/lib/postgresql/data`,
      lock.resolvedImage,
    ]);
    if (run.code !== 0) {
      fail(65, `docker run failed: ${run.stderr}`);
    }

    const portOut = await spawnFile([
      "docker",
      "port",
      containerName,
      "5432/tcp",
    ]);
    if (portOut.code !== 0) {
      fail(65, `docker port failed: ${portOut.stderr}`);
    }
    // format: 127.0.0.1:xxxxx
    const m = portOut.stdout.trim().match(/127\.0\.0\.1:(\d+)/);
    if (!m) {
      fail(65, `expected 127.0.0.1 binding, got: ${portOut.stdout}`);
    }
    hostPort = Number(m[1]);

    // Confirm inspect HostIp
    const inspect = await spawnFile([
      "docker",
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}} {{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      containerName,
    ]);
    const [hostIp, hostPortStr] = inspect.stdout.trim().split(/\s+/);
    if (hostIp !== "127.0.0.1") {
      fail(65, `non-loopback bind: ${hostIp}`);
    }
    hostPort = Number(hostPortStr);

    await waitForPort("127.0.0.1", hostPort);

    // Wait for ready (TCP inside container)
    let ready = false;
    for (let i = 0; i < 90; i++) {
      const r = await spawnFile([
        "docker",
        "exec",
        "-e",
        `PGPASSWORD=${adminPassword}`,
        containerName,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        adminUser,
        "-d",
        databaseName,
      ]);
      if (r.code === 0) {
        // Extra probe: simple SELECT
        const probe = await spawnFile([
          "docker",
          "exec",
          "-e",
          `PGPASSWORD=${adminPassword}`,
          containerName,
          "psql",
          "-h",
          "127.0.0.1",
          "-U",
          adminUser,
          "-d",
          databaseName,
          "-tAc",
          "SELECT 1",
        ]);
        if (probe.code === 0 && probe.stdout.trim() === "1") {
          ready = true;
          break;
        }
      }
      await sleep(500);
    }
    if (!ready) fail(66, "postgres not ready");

    const ver = await spawnFile([
      "docker",
      "exec",
      containerName,
      "postgres",
      "--version",
    ]);
    if (!/\b16\./.test(ver.stdout)) {
      fail(66, `expected postgres major 16, got: ${ver.stdout}`);
    }

    const sentinel = {
      schemaVersion: 1,
      runId: options.runId,
      ownerUnit: options.ownerUnit,
      purpose: options.purpose,
      imageDigest: options.imageDigest,
    };
    const sentinelJson = JSON.stringify(sentinel);
    // store as DB comment
    await execSql(
      containerName,
      adminUser,
      adminPassword,
      databaseName,
      `COMMENT ON DATABASE ${databaseName} IS '${sentinelJson.replace(/'/g, "''")}';`,
    );
    const readBack = await execSql(
      containerName,
      adminUser,
      adminPassword,
      databaseName,
      `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${databaseName}';`,
    );
    const parsedSentinel = JSON.parse(readBack);
    for (const k of Object.keys(sentinel)) {
      if (parsedSentinel[k] !== sentinel[k]) {
        fail(66, `sentinel field mismatch for ${k}`);
      }
    }

    const databaseUrl = `postgresql://${encodeURIComponent(adminUser)}:${encodeURIComponent(adminPassword)}@127.0.0.1:${hostPort}/${databaseName}`;

    receipt = {
      schemaVersion: 1,
      runId: options.runId,
      ownerUnit: options.ownerUnit,
      purpose: options.purpose,
      imageDigest: options.imageDigest,
      resolvedImage: lock.resolvedImage,
      major: 16,
      host: "127.0.0.1",
      port: hostPort,
      databaseName,
      adminUserRedacted: true,
      containerName,
      networkName,
      volumeName,
      sentinel,
      migrate: options.migrate,
      applicationRoleMode: options.applicationRoleMode,
      cleanupState: "open",
      createdAt: new Date().toISOString(),
    };

    const receiptPath = join(options.evidenceDir, "postgres-receipt.json");
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

    let migrationDatabaseUrl = databaseUrl;
    let appDatabaseUrl = databaseUrl;

    if (options.migrate) {
      const gen = await spawnFile(
        [
          "bash",
          join(options.repoRoot, "scripts/run-workspace-runtime.sh"),
          "root",
          "--",
          "corepack",
          "pnpm",
          "--filter",
          "@sangfor/db",
          "db:generate",
        ],
        {
          cwd: options.repoRoot,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
          },
        },
      );
      if (gen.code !== 0) {
        fail(67, `db:generate failed: ${gen.stderr || gen.stdout}`);
      }
      const mig = await spawnFile(
        [
          "bash",
          join(options.repoRoot, "scripts/run-workspace-runtime.sh"),
          "root",
          "--",
          "corepack",
          "pnpm",
          "--filter",
          "@sangfor/db",
          "db:migrate:deploy",
        ],
        {
          cwd: options.repoRoot,
          env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
          },
        },
      );
      if (mig.code !== 0) {
        fail(67, `db:migrate:deploy failed: ${mig.stderr || mig.stdout}`);
      }
    }

    if (options.applicationRoleMode === "required") {
      // Require migration-created roles; set local password for app login.
      const roleCheck = await execSql(
        containerName,
        adminUser,
        adminPassword,
        databaseName,
        `SELECT count(*) FROM pg_roles WHERE rolname IN ('sangfor_app','sangfor_app_login');`,
      );
      if (roleCheck !== "2") {
        fail(67, "applicationRoleMode=required but sangfor_app roles missing");
      }
      const appPass = randomSecret(24);
      await execSql(
        containerName,
        adminUser,
        adminPassword,
        databaseName,
        `ALTER ROLE sangfor_app_login WITH PASSWORD '${appPass.replace(/'/g, "''")}';`,
      );
      appDatabaseUrl = `postgresql://${encodeURIComponent("sangfor_app_login")}:${encodeURIComponent(appPass)}@127.0.0.1:${hostPort}/${databaseName}`;
    }

    const result = await callback({
      databaseUrl: appDatabaseUrl,
      migrationDatabaseUrl,
      taskOwnedDatabaseUrl: appDatabaseUrl,
      receiptPath,
      receipt: { ...receipt, credentialsRedacted: true },
      host: "127.0.0.1",
      port: hostPort,
      databaseName,
      sentinel,
      containerName,
    });

    // re-check sentinel
    const again = await execSql(
      containerName,
      adminUser,
      adminPassword,
      databaseName,
      `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${databaseName}';`,
    );
    JSON.parse(again);

    receipt.cleanupState = "closing";
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

    return result;
  } finally {
    try {
      await cleanupIsolatedPostgres(state);
      if (receipt) {
        receipt.cleanupState = "cleaned";
        writeFileSync(
          join(options.evidenceDir, "postgres-receipt.json"),
          JSON.stringify(receipt, null, 2),
        );
      }
    } catch (cleanupErr) {
      // Prefer surfacing cleanup failure with exit 68 if primary succeeded
      if (cleanupErr && cleanupErr.exitCode === 68) throw cleanupErr;
      const err = new Error(
        `cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
      );
      err.exitCode = 68;
      throw err;
    }
  }
}

/**
 * Pair of isolated databases (primary + secondary) for restore-drill style tests.
 */
export async function withIsolatedPostgresPair(rawOptions, callback) {
  const base = validateOptions(rawOptions);
  return withIsolatedPostgres(
    { ...rawOptions, purpose: `${base.purpose}-a` },
    async (a) =>
      withIsolatedPostgres(
        {
          ...rawOptions,
          purpose: `${base.purpose}-b`,
          evidenceDir: join(base.evidenceDir, "pair-b"),
        },
        async (b) => callback({ primary: a, secondary: b }),
      ),
  );
}

export {
  LABEL_RUN,
  LABEL_UNIT,
  LABEL_PURPOSE,
  DEFAULT_LOCK,
  spawnFile,
};
