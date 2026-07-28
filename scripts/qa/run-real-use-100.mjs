import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { DEFAULT_LOCK, withIsolatedPostgres } from "../lib/isolated-postgres.mjs";

const root = resolve(import.meta.dirname, "../..");

export function assertPortBindableOnLoopback(port, deps = {}) {
  const create = deps.createServer ?? createServer;
  return new Promise((resolvePort, reject) => {
    const server = create();
    server.once("error", (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      reject(new Error(`web port ${port} is not bindable on 127.0.0.1: ${detail}`));
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

export async function resolveWebPort(env = process.env, deps = {}) {
  const raw = (env.REAL_USE_WEB_PORT ?? env.PORT ?? "").trim();
  if (raw) {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`invalid web port: ${raw}`);
    }
    return assertPortBindableOnLoopback(port, deps);
  }
  const create = deps.createServer ?? createServer;
  return new Promise((resolvePort, reject) => {
    const server = create();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("failed to allocate free web port"));
        else resolvePort(port);
      });
    });
  });
}

export function buildWebBaseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

export function resolveFreshEvidenceDir(env, runId) {
  const evidenceDir = resolve(
    env.REAL_USE_EVIDENCE_DIR ?? join(root, ".omo/evidence", runId),
  );
  if (existsSync(evidenceDir)) {
    throw new Error(`fresh REAL_USE_EVIDENCE_DIR required: ${evidenceDir}`);
  }
  return evidenceDir;
}

export function isChildAlive(child) {
  if (!child) return false;
  if (child.killed) return false;
  if (child.exitCode != null) return false;
  if (child.signalCode != null) return false;
  return typeof child.pid === "number" && child.pid > 0;
}

export async function waitForOwnedWeb({
  baseUrl,
  child,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  maxAttempts = 360,
  intervalMs = 500,
}) {
  if (!baseUrl || !/^https?:\/\/127\.0\.0\.1:\d+(\/|$)/.test(baseUrl)) {
    throw new Error(`waitForOwnedWeb requires loopback baseUrl, got ${baseUrl}`);
  }
  const loginUrl = baseUrl.replace(/\/$/, "") + "/login";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!isChildAlive(child)) {
      throw new Error("web child exited before becoming ready");
    }
    try {
      const response = await fetchImpl(loginUrl, { signal: AbortSignal.timeout(1_000) });
      if (!isChildAlive(child)) {
        throw new Error("web child exited while probing readiness");
      }
      if (response.status < 500) return;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("web child")) throw error;
      if (!isChildAlive(child)) {
        throw new Error("web child exited before becoming ready");
      }
    }
    await sleepImpl(intervalMs);
  }
  throw new Error("web server did not become ready");
}

export function buildWebSpawnArgv(port) {
  return [
    "corepack",
    "pnpm",
    "--filter",
    "@sangfor/web",
    "exec",
    "next",
    "dev",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ];
}

function run(argv, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

export async function main(env = process.env) {
  const runId = env.REAL_USE_RUN_ID ?? `real-use-100-${Date.now()}`;
  const evidenceDir = resolveFreshEvidenceDir(env, runId);
  const stopFile = join(evidenceDir, "STOP");
  const imageLock = JSON.parse(readFileSync(DEFAULT_LOCK, "utf8"));
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

  const webPort = await resolveWebPort(env);
  const baseUrl = buildWebBaseUrl(webPort);

  const jwtSecret = Buffer.alloc(32, 107).toString("base64url");
  const auth = {
    USER_JWT_ACTIVE_KID: "real-use-100-key",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: "900",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [{
        kid: "real-use-100-key",
        state: "active",
        secretBase64Url: jwtSecret,
        activatedAt: "2026-01-01T00:00:00Z",
        demotedAt: null,
        verifyUntil: null,
        retiredAt: null,
      }],
    }),
    AUTH_DEMO_PASSWORD: "real-use-100-password",
  };

  await withIsolatedPostgres({
    runId,
    ownerUnit: "U076",
    purpose: "real-use-100-email-and-direct-input",
    evidenceDir,
    imageDigest: imageLock.manifestListDigest,
    migrate: true,
    applicationRoleMode: "required",
    repoRoot: root,
  }, async (postgres) => {
    const fixtureDir = join(evidenceDir, "fixtures");
    const taskDbUrl = postgres.migrationDatabaseUrl;
    const base = {
      ...env,
      ...auth,
      TASK_RUN_ID: runId,
      TASK_OWNER_UNIT: "U076",
      TASK_POSTGRES_RECEIPT_FILE: postgres.receiptPath,
      DATABASE_URL: taskDbUrl,
      TASK_OWNED_DATABASE_URL: taskDbUrl,
      UX_FIXTURE_MODE: "u076-final",
      UX_FIXTURE_OUTPUT_DIR: fixtureDir,
      PORT: String(webPort),
    };
    const fixture = await run(["corepack", "pnpm", "prepare:ux-fixtures"], base);
    if (fixture.code !== 0) throw new Error("fixture preparation failed");
    const fixtureReceipt = JSON.parse(readFileSync(join(fixtureDir, "ux-fixtures-receipt.json"), "utf8"));
    const runtime = {
      ...base,
      ...fixtureReceipt.env,
      NODE_ENV: "development",
      DATABASE_URL: taskDbUrl,
      TASK_OWNED_DATABASE_URL: taskDbUrl,
      SANGFOR_APP_DATABASE_URL: postgres.databaseUrl,
      REAL_USE_MAIL_MANIFEST: join(evidenceDir, "mail-input-50.json"),
      PORT: String(webPort),
    };
    const seed = await run(["corepack", "pnpm", "exec", "node", "scripts/qa/seed-real-use-mail.mjs"], runtime);
    if (seed.code !== 0) throw new Error("mail fixture seed failed");

    writeFileSync(join(evidenceDir, "runtime.json"), `${JSON.stringify({
      runId,
      baseUrl,
      port: webPort,
      databaseUrl: taskDbUrl,
      appDatabaseUrl: postgres.databaseUrl,
      storageState: join(fixtureDir, "storage-state", "sales_manager.json"),
      stopFile,
    }, null, 2)}\n`, { mode: 0o600 });

    const webArgv = buildWebSpawnArgv(webPort);
    const web = spawn(webArgv[0], webArgv.slice(1), {
      cwd: root,
      env: runtime,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    web.stdout.pipe(process.stdout);
    web.stderr.pipe(process.stderr);
    try {
      await waitForOwnedWeb({ baseUrl, child: web });
      if (!isChildAlive(web)) {
        throw new Error("web child is not alive after readiness check");
      }
      writeFileSync(join(evidenceDir, "READY"), `${new Date().toISOString()}\n`, { mode: 0o600 });
      process.stdout.write(`REAL_USE_READY ${evidenceDir} baseUrl=${baseUrl}\n`);
      while (!existsSync(stopFile)) {
        if (!isChildAlive(web)) throw new Error("web child exited during operator session");
        await sleep(500);
      }
    } finally {
      try { process.kill(-web.pid, "SIGTERM"); } catch {}
      await sleep(1_000);
      try { process.kill(-web.pid, "SIGKILL"); } catch {}
    }
  });
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entrypoint === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
