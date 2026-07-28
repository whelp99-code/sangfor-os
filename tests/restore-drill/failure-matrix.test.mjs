import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const MATRIX_PATH = join(REPO_ROOT, "tests/restore-drill/fixtures/failure-matrix.json");
const RESTORE_DRILL = join(REPO_ROOT, "scripts/restore-drill.mjs");
const LOCK_PATH = join(REPO_ROOT, "scripts/fixtures/restore-drill/postgres16-image.lock.json");
const DIGEST = JSON.parse(readFileSync(LOCK_PATH, "utf8")).manifestListDigest;
const LABELS = ["com.sangfor.refactor.run", "com.sangfor.refactor.unit", "com.sangfor.refactor.purpose"];

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

async function labelResourceCount(runId, purposeSuffix) {
  const filters = [
    `label=${LABELS[0]}=${runId}`,
    `label=${LABELS[1]}=U009`,
    `label=${LABELS[2]}=full-restore${purposeSuffix}`,
  ];
  let total = 0;
  for (const kind of [["docker", "ps", "-aq"], ["docker", "network", "ls", "-q"], ["docker", "volume", "ls", "-q"]]) {
    const result = await spawnCapture([...kind, ...filters.flatMap((f) => ["--filter", f])], process.env);
    total += result.stdout.trim() ? result.stdout.trim().split("\n").filter(Boolean).length : 0;
  }
  return total;
}

const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8"));

assert.deepEqual(
  matrix,
  [
    { scenario: "corrupt-dump", exitCode: 66, stage: "restore" },
    { scenario: "target-restore-failure", exitCode: 66, stage: "restore" },
    { scenario: "content-hash-mismatch", exitCode: 67, stage: "validation" },
    { scenario: "sequence-mismatch", exitCode: 67, stage: "validation" },
    { scenario: "validation-timeout", exitCode: 67, stage: "validation" },
  ],
  "tracked failure-matrix.json must keep the exact five rows in exact order",
);

describe("restore-drill failure-matrix (real PG16 containers per scenario)", { concurrency: 1 }, () => {
  for (const row of matrix) {
    it(
      `${row.scenario} -> exit ${row.exitCode} / stage ${row.stage}, no PASS receipt, cleanup 0`,
      { timeout: 180_000 },
      async () => {
        const evidenceDir = join(mkdtempSync(join(tmpdir(), "u009-fm-")), "run");
        const runId = `u009fm${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const childEnv = { ...process.env };
        delete childEnv.DATABASE_URL;
        try {
          const result = await spawnCapture(
            [
              process.execPath, RESTORE_DRILL,
              "--fixture", "--image-digest", DIGEST, "--run-id", runId, "--evidence-dir", evidenceDir,
              "--failure-scenario", row.scenario,
            ],
            childEnv,
          );

          assert.equal(result.code, row.exitCode, `expected exit ${row.exitCode}, got ${result.code}\nstderr: ${result.stderr}`);

          const receiptPath = join(evidenceDir, "receipt.json");
          assert.ok(existsSync(receiptPath), "a FAIL receipt must still be written");
          const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
          assert.notEqual(receipt.result, "PASS", "no authoritative PASS receipt for a failure scenario");
          assert.equal(receipt.result, "FAIL");
          assert.equal(receipt.exitCode, row.exitCode);
          assert.equal(receipt.failureStage, row.stage);
          assert.equal(receipt.cleanup.source.containers, 0);
          assert.equal(receipt.cleanup.source.networks, 0);
          assert.equal(receipt.cleanup.source.volumes, 0);
          assert.equal(receipt.cleanup.target.containers, 0);
          assert.equal(receipt.cleanup.target.networks, 0);
          assert.equal(receipt.cleanup.target.volumes, 0);

          const [sourceRemaining, targetRemaining] = await Promise.all([
            labelResourceCount(runId, "-a"),
            labelResourceCount(runId, "-b"),
          ]);
          assert.equal(sourceRemaining, 0, "source docker resources must be 0 after the scenario");
          assert.equal(targetRemaining, 0, "target docker resources must be 0 after the scenario");
        } finally {
          rmSync(dirname(evidenceDir), { recursive: true, force: true });
        }
      },
    );
  }
});
