import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
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

test("TOTP enrollment, step-up and replay refusal behave the same against real PostgreSQL", { timeout: 300_000 }, async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), "mfa-totp-flow-"));
  const previousPrefix = process.env.npm_config_prefix;
  const previousGlobalPrefix = process.env.npm_config_global_prefix;
  delete process.env.DATABASE_URL;
  delete process.env.DOCKER_HOST;
  delete process.env.DOCKER_CONTEXT;
  delete process.env.npm_config_prefix;
  delete process.env.npm_config_global_prefix;
  try {
    await withIsolatedPostgres(
      { runId: `mfa-totp-${Date.now()}`, ownerUnit: "auth-mfa", purpose: "totp-flow", evidenceDir, imageDigest, migrate: true },
      async ({ migrationDatabaseUrl }) => {
        const env = {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DATABASE_URL: migrationDatabaseUrl,
          MFA_TOTP_KEY: randomBytes(32).toString("base64"),
        };
        // The lane does not build workspaces for us, and the script imports the
        // package entrypoints rather than their sources.
        await spawnCommand(["pnpm", "--filter", "@sangfor/db...", "build"], env);
        await spawnCommand(["pnpm", "--filter", "@sangfor/auth...", "build"], env);
        const output = await spawnCommand(
          ["pnpm", "--filter", "@sangfor/web", "exec", "tsx", "../../scripts/mfa-totp-flow.ts"],
          env,
        );
        assert.match(output, /MFA_TOTP_FLOW=PASS/u);
      },
    );
  } finally {
    if (previousPrefix !== undefined) process.env.npm_config_prefix = previousPrefix;
    if (previousGlobalPrefix !== undefined) process.env.npm_config_global_prefix = previousGlobalPrefix;
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});
