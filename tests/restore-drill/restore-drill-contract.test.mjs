import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRestoreDrillArgs, ContractError, EXIT, FAILURE_SCENARIOS } from "../../scripts/lib/restore-drill/contract.mjs";
import * as fixtureSeed from "../../scripts/lib/restore-drill/fixture-seed.mjs";
import * as logicalBackup from "../../scripts/lib/restore-drill/logical-backup.mjs";
import * as databaseInventory from "../../scripts/lib/restore-drill/database-inventory.mjs";
import * as receiptLib from "../../scripts/lib/restore-drill/receipt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RESTORE_DRILL = join(REPO_ROOT, "scripts/restore-drill.mjs");
const LOCK_PATH = join(REPO_ROOT, "scripts/fixtures/restore-drill/postgres16-image.lock.json");
const DIGEST = JSON.parse(readFileSync(LOCK_PATH, "utf8")).manifestListDigest;
const MATRIX_PATH = join(REPO_ROOT, "tests/restore-drill/fixtures/failure-matrix.json");

function spawnCapture(argv, env) {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = argv;
    const start = Date.now();
    const child = spawn(cmd, args, { shell: false, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr, durationMs: Date.now() - start, pid: child.pid }));
  });
}

async function labelResourceCount(runId, purposeSuffix) {
  const filters = [
    `label=com.sangfor.refactor.run=${runId}`,
    "label=com.sangfor.refactor.unit=U009",
    `label=com.sangfor.refactor.purpose=full-restore${purposeSuffix}`,
  ];
  let total = 0;
  for (const kind of [["docker", "ps", "-aq"], ["docker", "network", "ls", "-q"], ["docker", "volume", "ls", "-q"]]) {
    const result = await spawnCapture([...kind, ...filters.flatMap((f) => ["--filter", f])], process.env);
    total += result.stdout.trim() ? result.stdout.trim().split("\n").filter(Boolean).length : 0;
  }
  return total;
}

describe("restore-drill owned helper/file graph", () => {
  it("contract.mjs exports the CLI contract exactly", () => {
    assert.equal(typeof parseRestoreDrillArgs, "function");
    assert.deepEqual(FAILURE_SCENARIOS, [
      "corrupt-dump", "target-restore-failure", "content-hash-mismatch", "sequence-mismatch", "validation-timeout",
    ]);
    assert.deepEqual(EXIT, { SUCCESS: 0, CONFIG: 64, BACKUP: 65, RESTORE: 66, VALIDATION: 67, CLEANUP: 68 });
  });

  it("fixture-seed.mjs exports applyDeterministicSeed against the exact tracked path", () => {
    assert.equal(typeof fixtureSeed.applyDeterministicSeed, "function");
    assert.equal(fixtureSeed.SEED_PATH, join(REPO_ROOT, "tests/restore-drill/fixtures/deterministic-seed.sql"));
    assert.ok(existsSync(fixtureSeed.SEED_PATH));
  });

  it("logical-backup.mjs exports dump/restore only", () => {
    assert.equal(typeof logicalBackup.createLogicalDump, "function");
    assert.equal(typeof logicalBackup.restoreLogicalDump, "function");
  });

  it("database-inventory.mjs exports the seven comparison/idempotency primitives", () => {
    for (const name of [
      "fetchSchemaRows", "fetchTableRows", "fetchSequenceRows", "fetchConstraintRows",
      "writeComparisonArtifact", "checkMigrationIdempotency", "writeValidationReport",
    ]) {
      assert.equal(typeof databaseInventory[name], "function", `missing export ${name}`);
    }
  });

  it("receipt.mjs exports schema validation, redaction, hashing, atomic write", () => {
    for (const name of ["validateAgainstSchemaFile", "redactCredentials", "sha256Hex", "atomicWriteJson"]) {
      assert.equal(typeof receiptLib[name], "function", `missing export ${name}`);
    }
  });

  it("both tracked receipt schema files exist and are valid JSON", () => {
    const rawSchema = JSON.parse(readFileSync(join(REPO_ROOT, "scripts/restore-drill-receipt.schema.json"), "utf8"));
    const s9aSchema = JSON.parse(readFileSync(join(REPO_ROOT, "scripts/s9a-contract-receipt.schema.json"), "utf8"));
    assert.equal(rawSchema.$id, "sangfor-restore-drill-receipt-v1");
    assert.equal(s9aSchema.$id, "sangfor-s9a-contract-receipt-v1");
  });

  it("the tracked failure-matrix.json enum matches contract.mjs FAILURE_SCENARIOS in order", () => {
    const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8"));
    assert.deepEqual(matrix.map((row) => row.scenario), FAILURE_SCENARIOS);
  });
});

describe("restore-drill.mjs CLI contract (no containers)", () => {
  let freshEvidenceDir;
  let preExistingEvidenceDir;

  before(() => {
    freshEvidenceDir = join(mkdtempSync(join(tmpdir(), "u009-cli-")), "fresh");
    preExistingEvidenceDir = mkdtempSync(join(tmpdir(), "u009-cli-existing-"));
  });
  after(() => {
    rmSync(dirname(freshEvidenceDir), { recursive: true, force: true });
    rmSync(preExistingEvidenceDir, { recursive: true, force: true });
  });

  it("parses the exact positive flag set", () => {
    const args = parseRestoreDrillArgs(["--fixture", "--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", freshEvidenceDir]);
    assert.deepEqual(args, { fixture: true, imageDigest: DIGEST, runId: "r1", evidenceDir: freshEvidenceDir, failureScenario: undefined });
  });

  it("parses the exact positive set plus one trailing --failure-scenario pair", () => {
    const args = parseRestoreDrillArgs([
      "--fixture", "--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", freshEvidenceDir, "--failure-scenario", "corrupt-dump",
    ]);
    assert.equal(args.failureScenario, "corrupt-dump");
  });

  const rejections = [
    ["missing --fixture", ["--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", "/tmp/x"]],
    ["unknown flag", ["--fixture", "--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", "/tmp/x", "--container-name", "sangfor-postgres"]],
    ["duplicate flag", ["--fixture", "--fixture", "--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", "/tmp/x"]],
    ["positional argument", ["--fixture", "--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", "/tmp/x", "positional"]],
    ["malformed image digest", ["--fixture", "--image-digest", "postgres:16", "--run-id", "r1", "--evidence-dir", "/tmp/x"]],
    ["unknown failure-scenario value", ["--fixture", "--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", "/tmp/x", "--failure-scenario", "wipe-volume"]],
  ];
  for (const [label, argv] of rejections) {
    it(`rejects ${label} with ContractError exit 64 before any resource`, () => {
      assert.throws(() => parseRestoreDrillArgs(argv), (error) => error instanceof ContractError && error.exitCode === 64);
    });
  }

  it("rejects a relative --evidence-dir", () => {
    assert.throws(
      () => parseRestoreDrillArgs(["--fixture", "--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", "relative/path"]),
      (error) => error instanceof ContractError && error.exitCode === 64,
    );
  });

  it("rejects a pre-existing --evidence-dir (no reuse of past evidence)", () => {
    assert.throws(
      () => parseRestoreDrillArgs(["--fixture", "--image-digest", DIGEST, "--run-id", "r1", "--evidence-dir", preExistingEvidenceDir]),
      (error) => error instanceof ContractError && error.exitCode === 64,
    );
  });
});

describe("restore-drill.mjs config-safety refusals (spawned process)", () => {
  it("refuses an ambient sentinel production DATABASE_URL without connecting", async () => {
    const evidenceDir = join(mkdtempSync(join(tmpdir(), "u009-dburl-")), "run");
    const childEnv = {
      ...process.env,
      DATABASE_URL: "postgresql://operator:sentinel-secret@db.production.example:5432/finance",
    };
    try {
      const result = await spawnCapture(
        [process.execPath, RESTORE_DRILL, "--fixture", "--image-digest", DIGEST, "--run-id", "u009dburl", "--evidence-dir", evidenceDir],
        childEnv,
      );
      assert.equal(result.code, 64);
      assert.match(result.stderr, /DATABASE_URL/);
      assert.ok(result.durationMs < 5000, `refusal must be immediate, took ${result.durationMs}ms`);
      assert.equal(existsSync(evidenceDir), false, "no evidence directory should be created for a config refusal");
    } finally {
      rmSync(dirname(evidenceDir), { recursive: true, force: true });
    }
  });
});

describe("restore-drill.mjs SIGTERM handling (real PG16 containers)", { concurrency: 1 }, () => {
  it("SIGTERM mid-run still cleans up to 0 and exits 128+15", { timeout: 120_000 }, async () => {
    const evidenceDir = join(mkdtempSync(join(tmpdir(), "u009-sigterm-")), "run");
    const runId = `u009sig${Date.now()}`;
    const childEnv = { ...process.env };
    delete childEnv.DATABASE_URL;
    try {
      const child = spawn(process.execPath, [RESTORE_DRILL, "--fixture", "--image-digest", DIGEST, "--run-id", runId, "--evidence-dir", evidenceDir], {
        shell: false,
        env: childEnv,
        stdio: ["ignore", "ignore", "ignore"],
      });
      const exitPromise = new Promise((resolvePromise) => child.on("close", (code, signal) => resolvePromise({ code, signal })));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
      child.kill("SIGTERM");
      const { code } = await exitPromise;
      assert.equal(code, 143);

      const [sourceRemaining, targetRemaining] = await Promise.all([
        labelResourceCount(runId, "-a"),
        labelResourceCount(runId, "-b"),
      ]);
      assert.equal(sourceRemaining, 0);
      assert.equal(targetRemaining, 0);
    } finally {
      rmSync(dirname(evidenceDir), { recursive: true, force: true });
    }
  });
});

describe("restore-drill.mjs leaves other-label resources alone (real Docker)", { concurrency: 1 }, () => {
  it("a differently-labeled sentinel container survives U009 cleanup", { timeout: 120_000 }, async () => {
    const sentinelName = `u009-sentinel-${Date.now()}`;
    await spawnCapture([
      "docker", "run", "-d", "--name", sentinelName,
      "--label", "com.sangfor.refactor.run=u009-sentinel-run",
      "--label", "com.sangfor.refactor.unit=U999",
      "--label", "com.sangfor.refactor.purpose=other-owner-sentinel",
      "postgres:16-alpine",
    ], process.env);

    const evidenceDir = join(mkdtempSync(join(tmpdir(), "u009-sentinel-")), "run");
    const runId = `u009sentinelrun${Date.now()}`;
    const childEnv = { ...process.env };
    delete childEnv.DATABASE_URL;
    try {
      const result = await spawnCapture(
        [process.execPath, RESTORE_DRILL, "--fixture", "--image-digest", DIGEST, "--run-id", runId, "--evidence-dir", evidenceDir],
        childEnv,
      );
      assert.equal(result.code, 0, result.stderr);

      const stillThere = await spawnCapture(["docker", "ps", "-aq", "--filter", `name=${sentinelName}`], process.env);
      assert.ok(stillThere.stdout.trim().length > 0, "other-label sentinel must survive U009 cleanup");
    } finally {
      await spawnCapture(["docker", "rm", "-f", sentinelName], process.env);
      rmSync(dirname(evidenceDir), { recursive: true, force: true });
    }
  });
});

describe("restore-drill boundary: no new dependency", () => {
  it("root package.json adds exactly the restore:drill script and zero dependency changes", () => {
    // A raw line-diff assertion is impossible to satisfy here: appending
    // restore:drill after the previously-last script (db:push:safe) requires
    // adding a trailing comma to that prior line, so the raw git diff is
    // +2/-1. What the dispatch actually requires is semantic: exactly one
    // new script key and zero dependency/devDependency drift.
    const committed = JSON.parse(execFileSync("git", ["show", "HEAD:package.json"], { cwd: REPO_ROOT, encoding: "utf8" }));
    const working = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

    const committedScriptKeys = new Set(Object.keys(committed.scripts));
    const workingScriptKeys = new Set(Object.keys(working.scripts));
    const addedScriptKeys = [...workingScriptKeys].filter((key) => !committedScriptKeys.has(key));
    const removedScriptKeys = [...committedScriptKeys].filter((key) => !workingScriptKeys.has(key));
    assert.deepEqual(addedScriptKeys, ["restore:drill"], "exactly one new script key must be added");
    assert.deepEqual(removedScriptKeys, [], "no existing script key should be removed");
    for (const key of committedScriptKeys) {
      assert.equal(working.scripts[key], committed.scripts[key], `existing script ${key} must be unchanged`);
    }
    assert.equal(working.scripts["restore:drill"], "node scripts/restore-drill.mjs");

    assert.deepEqual(working.dependencies, committed.dependencies, "dependencies must be byte-identical");
    assert.deepEqual(working.devDependencies, committed.devDependencies, "devDependencies must be byte-identical");
  });

  it("pnpm-lock.yaml has an exactly empty diff", () => {
    const diff = execFileSync("git", ["diff", "--stat", "--", "pnpm-lock.yaml"], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(diff.trim(), "");
  });
});
