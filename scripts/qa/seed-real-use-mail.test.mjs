import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";

import {
  assertTaskOwnedSeedEnvironment,
  seedRealUseMail,
} from "./seed-real-use-mail.mjs";

const qaDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(qaDir, "../..");

/** Resolve the official tsx CLI when installed; else Node native strip-types for the same .ts entry. */
function officialSeedEntrypointArgv() {
  const script = "scripts/qa/seed-real-use-mail.ts";
  try {
    const require = createRequire(join(repoRoot, "package.json"));
    const tsxCli = require.resolve("tsx/cli");
    return [process.execPath, tsxCli, script];
  } catch {
    // Keep the official .ts path under test even when node_modules is absent in a bare worktree.
    return [process.execPath, "--experimental-strip-types", script];
  }
}

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "u076-seed-"));
  temporaryDirectories.push(directory);
  return directory;
}

function taskReceipt(directory, overrides = {}) {
  const file = join(directory, "postgres-receipt.json");
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    runId: "u076-seed-test",
    ownerUnit: "U076",
    purpose: "real-use-100-email-and-direct-input",
    host: "127.0.0.1",
    port: 55432,
    databaseName: "sangfor_task_u076_seed_test",
    imageDigest: `sha256:${"b".repeat(64)}`,
    migrate: true,
    cleanupState: "open",
    sentinel: {
      schemaVersion: 1,
      runId: "u076-seed-test",
      ownerUnit: "U076",
      purpose: "real-use-100-email-and-direct-input",
      imageDigest: `sha256:${"b".repeat(64)}`,
    },
    ...overrides,
  }));
  return file;
}

function validEnvironment(receiptFile, overrides = {}) {
  const databaseUrl = "postgresql://u:p@127.0.0.1:55432/sangfor_task_u076_seed_test";
  return {
    DATABASE_URL: databaseUrl,
    TASK_OWNED_DATABASE_URL: databaseUrl,
    TASK_POSTGRES_RECEIPT_FILE: receiptFile,
    TASK_OWNER_UNIT: "U076",
    TASK_RUN_ID: "u076-seed-test",
    DEFAULT_PROJECT_ID: "project-seed",
    REAL_USE_MAIL_MANIFEST: join(fixtureDirectory(), "mail-input-50.json"),
    ...overrides,
  };
}

describe("seed-real-use-mail isolation gate (H2)", () => {
  it("requires task-owned URL equality and U076 identity before mutation", () => {
    assert.throws(() => assertTaskOwnedSeedEnvironment({}), /DATABASE_URL is required/);
    assert.throws(
      () => assertTaskOwnedSeedEnvironment({
        DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/sangfor_task_u076_seed_test",
      }),
      /TASK_OWNED_DATABASE_URL is required/,
    );
  });

  it("rejects non-loopback, non-task DB, and mismatched URL pairs", () => {
    const directory = fixtureDirectory();
    const receiptFile = taskReceipt(directory);
    const valid = validEnvironment(receiptFile);
    assert.throws(
      () => assertTaskOwnedSeedEnvironment({
        ...valid,
        DATABASE_URL: "postgresql://u:p@db.internal:55432/sangfor_task_u076_seed_test",
        TASK_OWNED_DATABASE_URL: "postgresql://u:p@db.internal:55432/sangfor_task_u076_seed_test",
      }),
      /loopback/,
    );
    assert.throws(
      () => assertTaskOwnedSeedEnvironment({
        ...valid,
        DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/sangfor",
        TASK_OWNED_DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/sangfor",
      }),
      /sangfor_task_\*/,
    );
    assert.throws(
      () => assertTaskOwnedSeedEnvironment({
        ...valid,
        TASK_OWNED_DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/sangfor_task_other",
      }),
      /exactly match/,
    );
  });

  it("rejects wrong owner, closed receipt, and unmigrated receipt", () => {
    const directory = fixtureDirectory();
    const receiptFile = taskReceipt(directory);
    const valid = validEnvironment(receiptFile);
    assert.throws(
      () => assertTaskOwnedSeedEnvironment({ ...valid, TASK_OWNER_UNIT: "U007" }),
      /TASK_OWNER_UNIT must be U076/,
    );

    writeFileSync(receiptFile, JSON.stringify({
      ...JSON.parse(readFileSync(receiptFile, "utf8")),
      cleanupState: "cleaned",
    }));
    assert.throws(() => assertTaskOwnedSeedEnvironment(valid), /not open/);

    writeFileSync(receiptFile, JSON.stringify({
      ...JSON.parse(readFileSync(receiptFile, "utf8")),
      cleanupState: "open",
      migrate: false,
    }));
    assert.throws(() => assertTaskOwnedSeedEnvironment(valid), /must confirm migrations/);
  });

  it("accepts an open migrated U076 task receipt that matches the URL identity", () => {
    const directory = fixtureDirectory();
    const receiptFile = taskReceipt(directory);
    const safety = assertTaskOwnedSeedEnvironment(validEnvironment(receiptFile));
    assert.equal(safety.ownerUnit, "U076");
    assert.equal(safety.databaseName, "sangfor_task_u076_seed_test");
    assert.equal(safety.databasePort, 55432);
    assert.match(safety.postgresReceiptSha256, /^[a-f0-9]{64}$/);
  });

  it("does not call mutation helpers when the isolation gate fails", async () => {
    let created = 0;
    await assert.rejects(
      () => seedRealUseMail(
        { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/sangfor" },
        {
          createMailAccount: async () => {
            created += 1;
            return { id: "x" };
          },
          createMailMessages: async () => {
            created += 1;
          },
        },
      ),
      /seed-real-use-mail:/,
    );
    assert.equal(created, 0);
  });

  it("seeds only after the gate passes (injected deps, no live DB)", async () => {
    const directory = fixtureDirectory();
    const receiptFile = taskReceipt(directory);
    const manifest = join(directory, "mail-input-50.json");
    const env = validEnvironment(receiptFile, { REAL_USE_MAIL_MANIFEST: manifest });
    let accounts = 0;
    let messages = 0;
    const result = await seedRealUseMail(env, {
      createMailAccount: async (data) => {
        accounts += 1;
        assert.equal(data.projectId, "project-seed");
        return { id: "account-1" };
      },
      createMailMessages: async (rows) => {
        messages = rows.length;
        assert.equal(rows.length, 50);
        assert.equal(rows[0].accountId, "account-1");
      },
      disconnect: async () => undefined,
    });
    assert.equal(accounts, 1);
    assert.equal(messages, 50);
    assert.equal(result.messages, 50);
    const written = JSON.parse(readFileSync(manifest, "utf8"));
    assert.equal(written.length, 50);
    assert.equal(written[0].channel, "email");
  });

  it("official .ts entrypoint exits 64 on invalid env before any mutation", async () => {
    const childEnv = { ...process.env };
    delete childEnv.DATABASE_URL;
    delete childEnv.TASK_OWNED_DATABASE_URL;
    delete childEnv.TASK_POSTGRES_RECEIPT_FILE;
    delete childEnv.TASK_OWNER_UNIT;
    delete childEnv.TASK_RUN_ID;

    const argv = officialSeedEntrypointArgv();
    assert.ok(
      argv.some((part) => String(part).endsWith("seed-real-use-mail.ts")),
      "must exercise the .ts entrypoint path",
    );

    const result = await new Promise((resolvePromise, reject) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: repoRoot,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolvePromise({ code: code ?? 1, signal, stdout, stderr });
      });
    });

    assert.equal(result.code, 64, `expected exit 64, got ${result.code}; stderr=${result.stderr}; argv=${argv.join(" ")}`);
    assert.match(result.stderr, /seed-real-use-mail:/);
    assert.equal(result.stdout.trim(), "");
  });
});
