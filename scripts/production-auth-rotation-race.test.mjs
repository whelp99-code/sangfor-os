import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { DEFAULT_LOCK, withIsolatedPostgres } from "./lib/isolated-postgres.mjs";

const imageDigest = JSON.parse(readFileSync(DEFAULT_LOCK, "utf8")).manifestListDigest;

function spawnCommand(args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("corepack", args, {
      cwd: new URL("..", import.meta.url),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(stderr || stdout)));
  });
}

async function runRace(databaseUrl) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DATABASE_URL: databaseUrl,
    USER_JWT_ACTIVE_KID: "race-key",
    USER_JWT_AUDIENCE: "sangfor-os-runtime",
    USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_ISSUER: "sangfor-os",
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_TTL_SECONDS: "28800",
    USER_JWT_KEYRING_JSON: JSON.stringify({ version: "sangfor.user-jwt-keyring/v1", keys: [{ kid: "race-key", state: "active", secretBase64Url: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc", activatedAt: "2026-01-01T00:00:00Z", demotedAt: null, verifyUntil: null, retiredAt: null }] }),
  };
  await spawnCommand(["pnpm", "--filter", "@sangfor/auth...", "build"], env);
  return spawnCommand(["pnpm", "--filter", "@sangfor/web", "exec", "tsx", "../../scripts/production-auth-rotation-race.ts"], env);
}

test("credential rotation leaves no live stale-password session in real PostgreSQL", { timeout: 240_000 }, async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "production-auth-race-"));
  const previousPrefix = process.env.npm_config_prefix;
  const previousGlobalPrefix = process.env.npm_config_global_prefix;
  delete process.env.DATABASE_URL;
  delete process.env.DOCKER_HOST;
  delete process.env.DOCKER_CONTEXT;
  delete process.env.npm_config_prefix;
  delete process.env.npm_config_global_prefix;
  try {
    await withIsolatedPostgres({ runId: `prod-auth-race-${Date.now()}`, ownerUnit: "production-deploy", purpose: "credential-rotation-race", evidenceDir, imageDigest, migrate: true }, async ({ migrationDatabaseUrl }) => {
      assert.match(await runRace(migrationDatabaseUrl), /PRODUCTION_AUTH_ROTATION_RACE=PASS/u);
    });
  } finally {
    if (previousPrefix !== undefined) process.env.npm_config_prefix = previousPrefix;
    if (previousGlobalPrefix !== undefined) process.env.npm_config_global_prefix = previousGlobalPrefix;
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});
