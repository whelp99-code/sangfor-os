import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_ENV_KEYS,
  REPO_ROOT,
  buildChildArgv,
  buildGitHeadArgv,
  computeFinalPaths,
  runS9aContract,
} from "./run-s9a-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = join(REPO_ROOT, "scripts/fixtures/restore-drill/postgres16-image.lock.json");
const DIGEST = JSON.parse(readFileSync(LOCK_PATH, "utf8")).manifestListDigest;
const SHA = "b".repeat(40);
const CHECK_KEYS = ["dump", "restore", "schema", "tableCount", "contentHash", "sequence", "constraint", "migrationIdempotency", "rpo", "rto"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let ownedRoots = [];
function mkTempRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  ownedRoots.push(root);
  return root;
}
after(() => {
  for (const root of ownedRoots) rmSync(root, { recursive: true, force: true });
});

function writeLease(path, { runId, ownerUnit = "U071", extra = {} } = {}) {
  const now = Date.now();
  const lease = {
    runId,
    ownerUnit,
    webPort: 41000 + (now % 1000),
    apiPort: 42000 + ((now + 500) % 1000),
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    ...extra,
  };
  writeFileSync(path, JSON.stringify(lease));
  return lease;
}

function validRawReceipt({ runId, imageDigest, checksOverrides = {}, overrides = {} }) {
  const checks = {
    dump: "PASS", restore: "PASS", schema: "PASS", tableCount: "PASS", contentHash: "PASS",
    sequence: "PASS", constraint: "PASS", migrationIdempotency: "PASS", rpo: "PASS", rto: "PASS",
    ...checksOverrides,
  };
  return {
    schemaVersion: 1,
    unit: "U009",
    runId,
    lifecycleProvider: "scripts/lib/isolated-postgres.mjs#withIsolatedPostgresPair",
    imageDigest,
    postgresMajor: 16,
    fixtureSha256: "a".repeat(64),
    exitCode: 0,
    result: "PASS",
    sourceSentinelMatch: true,
    targetSentinelMatch: true,
    checks,
    rpo: { measuredMs: 1000, thresholdMs: 90000000, provisional: true, status: "PASS" },
    rto: { measuredMs: 1000, thresholdMs: 900000, provisional: true, status: "PASS" },
    cleanup: {
      source: { containers: 0, networks: 0, volumes: 0 },
      target: { containers: 0, networks: 0, volumes: 0 },
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function setupRun(context = {}) {
  const root = mkTempRoot("u009-s9a-");
  const aliasEvidenceDir = join(root, "evidence");
  mkdirSync(aliasEvidenceDir, { recursive: true });
  const leaseFile = join(root, "lease.json");
  const runId = context.runId ?? `u009-s9a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  writeLease(leaseFile, { runId, ...context.leaseOptions });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TASK_RUN_ID: runId,
    TASK_OWNER_UNIT: "U071",
    RESOURCE_LEASE_FILE: leaseFile,
    ALIAS_EVIDENCE_DIR: aliasEvidenceDir,
    FINAL_CANDIDATE_SHA: context.sha ?? SHA,
    ...context.extraEnv,
  };
  return { root, aliasEvidenceDir, leaseFile, runId, env };
}

/** Fake `runCapture` for the git rev-parse HEAD checks: returns `firstSha` on
 * the first call (pre-restore) and `secondSha` (default: same) on every
 * subsequent call (post-restore). */
function makeRunCapture(firstSha, secondSha = firstSha) {
  let calls = 0;
  return async () => {
    calls += 1;
    return { code: 0, stdout: `${calls === 1 ? firstSha : secondSha}\n`, stderr: "" };
  };
}

/** Fake `spawnChild`: records every invocation, optionally writes raw
 * evidence into the `--evidence-dir` argv value, and resolves `done`
 * immediately with the given exit code (or lets the test drive `kill`). */
function makeSpawnChild({ rawContent, exitCode = 0 } = {}) {
  const calls = [];
  const fn = (argv, env) => {
    calls.push({ argv, env });
    const evidenceDirIndex = argv.indexOf("--evidence-dir");
    const rawEvidenceDir = argv[evidenceDirIndex + 1];
    if (rawContent !== undefined) {
      mkdirSync(rawEvidenceDir, { recursive: true });
      const content = typeof rawContent === "function" ? rawContent(argv) : rawContent;
      writeFileSync(join(rawEvidenceDir, "receipt.json"), content);
    }
    const child = { kill: () => {} };
    return { child, done: Promise.resolve({ code: exitCode, signal: null }) };
  };
  fn.calls = calls;
  return fn;
}

/** Fake `spawnChild` for signal tests: `child.kill(signal)` resolves `done`
 * with `{code:null, signal}`, and records the invocation start via a
 * resolvable "spawned" gate the test can await before emitting a signal. */
function makeControllableSpawnChild() {
  let spawnedResolve;
  const spawned = new Promise((resolvePromise) => { spawnedResolve = resolvePromise; });
  const calls = [];
  let killedWith = null;
  const fn = (argv, env) => {
    calls.push({ argv, env });
    let doneResolve;
    const done = new Promise((resolvePromise) => { doneResolve = resolvePromise; });
    const child = { kill: (signal) => { killedWith = signal; doneResolve({ code: null, signal }); } };
    spawnedResolve();
    return { child, done };
  };
  fn.calls = calls;
  fn.spawned = spawned;
  fn.killedWith = () => killedWith;
  return fn;
}

describe("run-s9a-contract.mjs preflight (no resource, no spawn)", () => {
  it("rejects any non-empty CLI argv before touching env/lease/spawn", async () => {
    const { env } = setupRun();
    const spawnChild = makeSpawnChild({ rawContent: JSON.stringify(validRawReceipt({ runId: "x", imageDigest: DIGEST })) });
    const result = await runS9aContract({ argv: ["--unexpected"], env, deps: { spawnChild } });
    assert.equal(result.exitCode, 64);
    assert.equal(spawnChild.calls.length, 0);
  });

  for (const key of FORBIDDEN_ENV_KEYS) {
    it(`rejects forbidden env var ${key} before any resource`, async () => {
      const { env } = setupRun();
      env[key] = "forbidden-value";
      const spawnChild = makeSpawnChild({ rawContent: JSON.stringify(validRawReceipt({ runId: env.TASK_RUN_ID, imageDigest: DIGEST })) });
      const result = await runS9aContract({ argv: [], env, deps: { spawnChild } });
      assert.equal(result.exitCode, 64);
      assert.equal(spawnChild.calls.length, 0);
    });
  }

  const requiredEnvCases = [
    ["missing TASK_RUN_ID", (env) => { delete env.TASK_RUN_ID; }],
    ["wrong TASK_OWNER_UNIT", (env) => { env.TASK_OWNER_UNIT = "U074"; }],
    ["relative RESOURCE_LEASE_FILE", (env) => { env.RESOURCE_LEASE_FILE = "relative/lease.json"; }],
    ["relative ALIAS_EVIDENCE_DIR", (env) => { env.ALIAS_EVIDENCE_DIR = "relative/evidence"; }],
    ["malformed FINAL_CANDIDATE_SHA", (env) => { env.FINAL_CANDIDATE_SHA = "not-a-sha"; }],
    ["uppercase FINAL_CANDIDATE_SHA", (env) => { env.FINAL_CANDIDATE_SHA = SHA.toUpperCase(); }],
  ];
  for (const [label, mutate] of requiredEnvCases) {
    it(`rejects ${label} before any resource`, async () => {
      const { env } = setupRun();
      mutate(env);
      const spawnChild = makeSpawnChild({});
      const result = await runS9aContract({ argv: [], env, deps: { spawnChild } });
      assert.equal(result.exitCode, 64);
      assert.equal(spawnChild.calls.length, 0);
    });
  }

  it("rejects a lease file with an unknown field (including s9aReceiptFile) before any resource", async () => {
    const { aliasEvidenceDir, leaseFile, runId, env } = setupRun();
    writeLease(leaseFile, { runId, extra: { s9aReceiptFile: "/tmp/should-not-exist.json" } });
    const spawnChild = makeSpawnChild({});
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild } });
    assert.equal(result.exitCode, 64);
    assert.equal(spawnChild.calls.length, 0);
  });

  it("rejects a lease ownerUnit/runId mismatch before any resource", async () => {
    const { leaseFile, runId, env } = setupRun();
    writeLease(leaseFile, { runId: `${runId}-different` });
    const spawnChild = makeSpawnChild({});
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild } });
    assert.equal(result.exitCode, 64);
    assert.equal(spawnChild.calls.length, 0);
  });

  it("rejects a digest-lock schema mismatch (major != 16) before any resource", async () => {
    const { root, env } = setupRun();
    const badLockPath = join(root, "bad-lock.json");
    writeFileSync(badLockPath, JSON.stringify({
      repository: "docker.io/library/postgres", sourceTag: "16-alpine", major: 15,
      manifestListDigest: DIGEST, resolvedImage: `docker.io/library/postgres@${DIGEST}`,
    }));
    const spawnChild = makeSpawnChild({});
    const runCapture = makeRunCapture(SHA);
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture, lockPath: badLockPath } });
    assert.equal(result.exitCode, 64);
    assert.equal(spawnChild.calls.length, 0);
  });

  it("rejects a digest-lock with a tampered manifestListDigest before any resource", async () => {
    const { root, env } = setupRun();
    const badLockPath = join(root, "bad-digest-lock.json");
    const tamperedDigest = `sha256:${"0".repeat(64)}`;
    writeFileSync(badLockPath, JSON.stringify({
      repository: "docker.io/library/postgres", sourceTag: "16-alpine", major: 16,
      manifestListDigest: tamperedDigest, resolvedImage: "docker.io/library/postgres@wrong",
    }));
    const spawnChild = makeSpawnChild({});
    const runCapture = makeRunCapture(SHA);
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture, lockPath: badLockPath } });
    assert.equal(result.exitCode, 64);
    assert.equal(spawnChild.calls.length, 0);
  });

  it("rejects a stale candidate: git HEAD != FINAL_CANDIDATE_SHA before restore", async () => {
    const { env } = setupRun({ sha: SHA });
    const runCapture = makeRunCapture("c".repeat(40));
    const spawnChild = makeSpawnChild({});
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 64);
    assert.equal(spawnChild.calls.length, 0);
  });

  it("rejects when ALIAS_EVIDENCE_DIR/s9a already exists before any resource", async () => {
    const { aliasEvidenceDir, env } = setupRun();
    mkdirSync(join(aliasEvidenceDir, "s9a"), { recursive: true });
    writeFileSync(join(aliasEvidenceDir, "s9a/receipt.json"), "stale\n");
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({});
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 64);
    assert.equal(spawnChild.calls.length, 0);
  });

  it("rejects when ALIAS_EVIDENCE_DIR does not exist", async () => {
    const { root, env } = setupRun();
    env.ALIAS_EVIDENCE_DIR = join(root, "never-created");
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({});
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 64);
    assert.equal(spawnChild.calls.length, 0);
  });
});

describe("run-s9a-contract.mjs raw receipt validation (fake spawn, no Docker)", () => {
  it("rejects a malformed (non-JSON) raw receipt and publishes nothing", async () => {
    const { aliasEvidenceDir, runId, env } = setupRun();
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({ rawContent: "not json\n" });
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 67);
    assert.equal(spawnChild.calls.length, 1);
    assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
    assert.deepEqual(readdirSync(aliasEvidenceDir), []);
  });

  it("rejects a raw receipt whose declared runId does not match the launched run (identity/hash-binding mismatch)", async () => {
    const { aliasEvidenceDir, runId, env } = setupRun();
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({
      rawContent: JSON.stringify(validRawReceipt({ runId: `${runId}-tampered`, imageDigest: DIGEST })),
    });
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 67);
    assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
  });

  it("rejects a raw receipt whose declared imageDigest does not match the locked digest", async () => {
    const { aliasEvidenceDir, runId, env } = setupRun();
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({
      rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: `sha256:${"1".repeat(64)}` })),
    });
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 67);
    assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
  });

  it("rejects a stale final SHA drift detected after the restore child completes", async () => {
    const { aliasEvidenceDir, runId, env } = setupRun();
    const runCapture = makeRunCapture(SHA, "d".repeat(40));
    const spawnChild = makeSpawnChild({ rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: DIGEST })) });
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 64);
    assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
  });

  for (const key of CHECK_KEYS) {
    it(`rejects a raw receipt with check "${key}" not PASS`, async () => {
      const { aliasEvidenceDir, runId, env } = setupRun();
      const runCapture = makeRunCapture(SHA);
      const spawnChild = makeSpawnChild({
        rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: DIGEST, checksOverrides: { [key]: "FAIL" } })),
      });
      const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
      assert.equal(result.exitCode, 67, `expected 67 for check ${key}, got ${result.exitCode}`);
      assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
    });
  }

  it("rejects a raw receipt whose sentinel match is not true on both sides", async () => {
    const { aliasEvidenceDir, runId, env } = setupRun();
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({
      rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: DIGEST, overrides: { targetSentinelMatch: false } })),
    });
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 67);
    assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
  });

  const cleanupResidueCases = [
    ["source.containers", { source: { containers: 1, networks: 0, volumes: 0 }, target: { containers: 0, networks: 0, volumes: 0 } }],
    ["source.networks", { source: { containers: 0, networks: 1, volumes: 0 }, target: { containers: 0, networks: 0, volumes: 0 } }],
    ["source.volumes", { source: { containers: 0, networks: 0, volumes: 1 }, target: { containers: 0, networks: 0, volumes: 0 } }],
    ["target.containers", { source: { containers: 0, networks: 0, volumes: 0 }, target: { containers: 1, networks: 0, volumes: 0 } }],
    ["target.networks", { source: { containers: 0, networks: 0, volumes: 0 }, target: { containers: 0, networks: 1, volumes: 0 } }],
    ["target.volumes", { source: { containers: 0, networks: 0, volumes: 0 }, target: { containers: 0, networks: 0, volumes: 1 } }],
  ];
  for (const [label, cleanup] of cleanupResidueCases) {
    it(`rejects with exit 68 when ${label} cleanup residue is nonzero`, async () => {
      const { aliasEvidenceDir, runId, env } = setupRun();
      const runCapture = makeRunCapture(SHA);
      const spawnChild = makeSpawnChild({
        rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: DIGEST, overrides: { cleanup } })),
      });
      const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
      assert.equal(result.exitCode, 68, `expected 68 for ${label}, got ${result.exitCode}`);
      assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
    });
  }
});

describe("run-s9a-contract.mjs child process contract", () => {
  it("spawns the restore child exactly once with the exact tracked argv", async () => {
    const { aliasEvidenceDir, runId, env } = setupRun();
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({ rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: DIGEST })) });
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 0, JSON.stringify(result.error?.message));
    assert.equal(spawnChild.calls.length, 1);
    const { argv } = spawnChild.calls[0];
    const rawDirIndex = argv.indexOf("--evidence-dir") + 1;
    const expected = buildChildArgv({ repoRoot: REPO_ROOT, imageDigest: DIGEST, runId, rawEvidenceDir: argv[rawDirIndex] });
    assert.deepEqual(argv, expected);
    assert.deepEqual(argv.slice(0, 8), ["bash", join(REPO_ROOT, "scripts/run-workspace-runtime.sh"), "root", "--", "corepack", "pnpm", "restore:drill", "--"]);
  });

  it("propagates a non-zero child exit code and publishes nothing", async () => {
    const { aliasEvidenceDir, env } = setupRun();
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({ exitCode: 66 });
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 66);
    assert.equal(spawnChild.calls.length, 1);
    assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
  });

  it("uses the git rev-parse HEAD argv exactly as specified", () => {
    assert.deepEqual(
      buildGitHeadArgv("/repo"),
      ["bash", "/repo/scripts/run-workspace-runtime.sh", "root", "--", "git", "rev-parse", "HEAD"],
    );
  });
});

describe("run-s9a-contract.mjs signal handling", () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    it(`forwards ${signal} to the restore child and exits 128+signal after cleanup`, async () => {
      const { aliasEvidenceDir, env } = setupRun();
      const runCapture = makeRunCapture(SHA);
      const spawnChild = makeControllableSpawnChild();
      const runPromise = runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
      await spawnChild.spawned;
      process.emit(signal);
      const result = await runPromise;
      const expected = signal === "SIGINT" ? 130 : 143;
      assert.equal(result.exitCode, expected);
      assert.equal(spawnChild.killedWith(), signal);
      assert.equal(existsSync(join(aliasEvidenceDir, "s9a")), false);
      // Staging directory must be cleaned; only the lease file should remain.
      assert.deepEqual(readdirSync(aliasEvidenceDir), []);
    });
  }
});

describe("run-s9a-contract.mjs success path (deterministic receipt + sidecar)", () => {
  it("publishes a fresh s9a/receipt.json + receipt.sha256 that passes the tracked schema", async () => {
    const { aliasEvidenceDir, runId, env } = setupRun();
    const runCapture = makeRunCapture(SHA);
    const spawnChild = makeSpawnChild({ rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: DIGEST })) });
    const result = await runS9aContract({ argv: [], env, deps: { spawnChild, runCapture } });
    assert.equal(result.exitCode, 0, JSON.stringify(result.error?.message));

    const finalPaths = computeFinalPaths(aliasEvidenceDir);
    assert.ok(existsSync(finalPaths.receiptFile));
    assert.ok(existsSync(finalPaths.sidecarFile));

    const receiptBytes = readFileSync(finalPaths.receiptFile);
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.unit, "U009");
    assert.equal(receipt.alias, "T-OPS");
    assert.equal(receipt.runId, runId);
    assert.equal(receipt.finalCandidateSha, SHA);
    assert.equal(receipt.imageDigest, DIGEST);
    assert.equal(receipt.postgresMajor, 16);
    assert.equal(receipt.result, "PASS");
    assert.equal(receipt.restoreDrill.exitCode, 0);
    assert.equal(receipt.restoreDrill.rawReceiptRelativePath, "raw/receipt.json");
    for (const key of CHECK_KEYS) assert.equal(receipt.restoreDrill.checks[key], "PASS");
    assert.deepEqual(receipt.cleanup, {
      source: { containers: 0, networks: 0, volumes: 0 },
      target: { containers: 0, networks: 0, volumes: 0 },
    });

    const rawBytes = readFileSync(join(finalPaths.dir, "raw/receipt.json"));
    assert.equal(receipt.restoreDrill.rawReceiptSha256, sha256(rawBytes));

    const sidecar = readFileSync(finalPaths.sidecarFile, "utf8");
    assert.equal(sidecar, `${sha256(receiptBytes)}\n`);

    // No leftover staging directory: only "s9a" and the lease file remain.
    assert.deepEqual(readdirSync(aliasEvidenceDir).sort(), ["s9a"]);

    const lockSha256 = sha256(readFileSync(LOCK_PATH));
    assert.equal(receipt.lockFileSha256, lockSha256);
  });

  it("refuses to run a second time against the same evidence dir (no reuse/overwrite)", async () => {
    const { aliasEvidenceDir, runId, env } = setupRun();
    const runCapture = () => Promise.resolve({ code: 0, stdout: `${SHA}\n`, stderr: "" });
    const spawnChild1 = makeSpawnChild({ rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: DIGEST })) });
    const first = await runS9aContract({ argv: [], env, deps: { spawnChild: spawnChild1, runCapture } });
    assert.equal(first.exitCode, 0, JSON.stringify(first.error?.message));

    const spawnChild2 = makeSpawnChild({ rawContent: JSON.stringify(validRawReceipt({ runId, imageDigest: DIGEST })) });
    const second = await runS9aContract({ argv: [], env, deps: { spawnChild: spawnChild2, runCapture } });
    assert.equal(second.exitCode, 64);
    assert.equal(spawnChild2.calls.length, 0);
  });
});
