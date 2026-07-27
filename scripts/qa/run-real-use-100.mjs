import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { DEFAULT_LOCK, withIsolatedPostgres } from "../lib/isolated-postgres.mjs";

const root = resolve(import.meta.dirname, "../..");
const evidenceDir = resolve(process.env.REAL_USE_EVIDENCE_DIR ?? join(root, ".omo/evidence/real-use-100-current"));
const runId = process.env.REAL_USE_RUN_ID ?? `real-use-100-${Date.now()}`;
const stopFile = join(evidenceDir, "STOP");
const imageLock = JSON.parse(readFileSync(DEFAULT_LOCK, "utf8"));
mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

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

async function waitForWeb() {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3101/login", { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("web server did not become ready");
}

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
  const base = {
    ...process.env,
    ...auth,
    TASK_RUN_ID: runId,
    TASK_OWNER_UNIT: "U076",
    TASK_POSTGRES_RECEIPT_FILE: postgres.receiptPath,
    DATABASE_URL: postgres.migrationDatabaseUrl,
    TASK_OWNED_DATABASE_URL: postgres.migrationDatabaseUrl,
    UX_FIXTURE_MODE: "u076-final",
    UX_FIXTURE_OUTPUT_DIR: fixtureDir,
  };
  const fixture = await run(["corepack", "pnpm", "prepare:ux-fixtures"], base);
  if (fixture.code !== 0) throw new Error("fixture preparation failed");
  const fixtureReceipt = JSON.parse(readFileSync(join(fixtureDir, "ux-fixtures-receipt.json"), "utf8"));
  const runtime = {
    ...base,
    ...fixtureReceipt.env,
    NODE_ENV: "development",
    DATABASE_URL: postgres.migrationDatabaseUrl,
    TASK_OWNED_DATABASE_URL: postgres.databaseUrl,
    SANGFOR_APP_DATABASE_URL: postgres.databaseUrl,
    REAL_USE_MAIL_MANIFEST: join(evidenceDir, "mail-input-50.json"),
  };
  const seed = await run(["corepack", "pnpm", "exec", "tsx", "scripts/qa/seed-real-use-mail.ts"], runtime);
  if (seed.code !== 0) throw new Error("mail fixture seed failed");

  writeFileSync(join(evidenceDir, "runtime.json"), `${JSON.stringify({
    runId,
    baseUrl: "http://127.0.0.1:3101",
    databaseUrl: postgres.migrationDatabaseUrl,
    appDatabaseUrl: postgres.databaseUrl,
    storageState: join(fixtureDir, "storage-state", "sales_manager.json"),
    stopFile,
  }, null, 2)}\n`, { mode: 0o600 });

  const web = spawn("corepack", ["pnpm", "--filter", "@sangfor/web", "dev"], {
    cwd: root,
    env: runtime,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  web.stdout.pipe(process.stdout);
  web.stderr.pipe(process.stderr);
  try {
    await waitForWeb();
    writeFileSync(join(evidenceDir, "READY"), `${new Date().toISOString()}\n`, { mode: 0o600 });
    process.stdout.write(`REAL_USE_READY ${evidenceDir}\n`);
    while (!existsSync(stopFile)) await sleep(500);
  } finally {
    try { process.kill(-web.pid, "SIGTERM"); } catch {}
    await sleep(1_000);
    try { process.kill(-web.pid, "SIGKILL"); } catch {}
  }
});
