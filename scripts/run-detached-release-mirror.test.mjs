import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  deriveRunnerContractChecks,
  engineerPrismaGenerateInnerArgv,
  evaluateNodeTestTap,
  finalAcceptanceInnerArgv,
  frozenInstallInnerArgv,
  nonceAuthorityInnerArgv,
  runU076CleanMirrorBootstrap,
  runDetachedReleaseMirrorMain,
  validateScmHandoff,
} from "./run-detached-release-mirror.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "run-detached-release-mirror.mjs");
const RECEIPT_CHECKER = join(HERE, "check-release-state-receipts.mjs");
const HEAD = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

function writeLease(dir, overrides = {}) {
  const body = {
    runId: "run-selftest",
    ownerUnit: "U007",
    webPort: 15101,
    apiPort: 15200,
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
  const p = join(dir, "lease.json");
  writeFileSync(p, JSON.stringify(body));
  chmodSync(p, 0o600);
  chmodSync(dir, 0o700);
  return p;
}

function writeScmHandoff(dir, candidateSha, overrides = {}) {
  const handoff = join(dir, "scm-handoff.json");
  writeFileSync(handoff, JSON.stringify({
    candidateSha,
    committedBy: "SCM",
    issuedAt: "2026-07-26T00:00:00.000Z",
    sourceHead: candidateSha,
    sourceStatus: "clean",
    ...overrides,
  }));
  return handoff;
}

/** Capture process.exit without killing the test runner. */
async function captureExit(fn) {
  const original = process.exit;
  /** @type {number|undefined} */
  let code;
  process.exit = /** @type {never} */ (
    (c) => {
      code = typeof c === "number" ? c : 0;
      throw new Error(`__EXIT__:${code}`);
    }
  );
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.startsWith("__EXIT__:")) throw err;
  } finally {
    process.exit = original;
  }
  return code;
}

/** Stub every expensive runner-contract sub-step (real mirror lifecycle still runs). */
function allPassInject(overrides = {}) {
  return {
    installs: { ok: true, detail: { stub: true } },
    manifest19Lanes: { ok: true, detail: { stub: true } },
    strictResultParser: { ok: true, detail: { stub: true } },
    falseGreenFixtures: { ok: true, detail: { stub: true } },
    sanitizedEnv: { ok: true, detail: { stub: true } },
    scratchPostgres: { ok: true, detail: { stub: true } },
    apiProductionStart: {
      ok: true,
      detail: {
        build: { code: 0, argv: ["stub-build"], stub: true },
        start: { healthStatus: 200, listeners: 0, stub: true },
      },
    },
    playwrightCoreFlow: {
      ok: true,
      detail: {
        playwright: { code: 0, total: 1, skipped: 0, retries: 0, flaky: 0, stub: true },
      },
    },
    ...overrides,
  };
}

function historicalPreU030Scan() {
  return {
    findings: [
      {
        name: "@sangfor/ui",
        testScript: "echo No tests",
        reason: "FALSE_GREEN_TEST_SCRIPT",
      },
    ],
  };
}

describe("run-detached-release-mirror", () => {
  it("binds an exact canonical SCM handoff to the candidate SHA", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "u076-scm-handoff-")));
    try {
      const handoff = writeScmHandoff(dir, HEAD);
      const result = validateScmHandoff(handoff, HEAD);
      assert.equal(result.file, handoff);
      assert.match(result.sha256, /^[a-f0-9]{64}$/);
      assert.throws(() => validateScmHandoff(writeScmHandoff(dir, HEAD, { sourceStatus: "dirty" }), HEAD), /identity or shape/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("invokes final acceptance directly without a pnpm argument separator", () => {
    assert.deepEqual(finalAcceptanceInnerArgv("/attempt/context.json", "f".repeat(64)), [
      "bash",
      "scripts/run-workspace-runtime.sh",
      "root",
      "--",
      "node",
      "scripts/run-final-acceptance.mjs",
      "--mirror-context-file",
      "/attempt/context.json",
      "--mirror-context-sha256",
      "f".repeat(64),
    ]);
  });

  it("runs the frozen standalone nonce authority release gate after all installs and before the root build", async () => {
    const argv = [];
    const ctx = {
      makeChildEnv: (lane) => ({ lane }),
      spawnInMirror: async (command) => {
        argv.push(command);
        return JSON.stringify(command) === JSON.stringify(nonceAuthorityInnerArgv(["corepack", "pnpm", "test"]))
          ? { code: 0, stdout: "Tests  1 passed\n", stderr: "" }
          : { code: 0, stdout: "", stderr: "" };
      },
    };

    const bootstrap = await runU076CleanMirrorBootstrap(ctx);

    assert.deepEqual(engineerPrismaGenerateInnerArgv(), [
      "bash",
      "scripts/run-workspace-runtime.sh",
      "engineer",
      "--",
      "corepack",
      "pnpm",
      "exec",
      "prisma",
      "generate",
    ]);
    assert.deepEqual(nonceAuthorityInnerArgv(["corepack", "pnpm", "test"]), [
      "bash",
      "scripts/run-workspace-runtime.sh",
      "nonce",
      "--",
      "corepack",
      "pnpm",
      "test",
    ]);
    assert.deepEqual(frozenInstallInnerArgv("nonce"), [
      "bash",
      "scripts/run-workspace-runtime.sh",
      "nonce",
      "--",
      "corepack",
      "pnpm",
      "install",
      "--ignore-workspace",
      "--frozen-lockfile",
      "--prefer-offline",
    ]);
    assert.deepEqual(bootstrap.nonceAuthorityReleaseGate.map(({ id, argv, verdict }) => ({ id, argv, verdict })), [
      { id: "nonce-lint", argv: nonceAuthorityInnerArgv(["corepack", "pnpm", "lint"]), verdict: "PASS" },
      { id: "nonce-typecheck", argv: nonceAuthorityInnerArgv(["corepack", "pnpm", "typecheck"]), verdict: "PASS" },
      { id: "nonce-unit", argv: nonceAuthorityInnerArgv(["corepack", "pnpm", "test"]), verdict: "PASS" },
      { id: "nonce-build", argv: nonceAuthorityInnerArgv(["corepack", "pnpm", "build"]), verdict: "PASS" },
    ]);
    assert.deepEqual(argv, [
      ...["root", "engineer", "workflow", "nonce"].map(frozenInstallInnerArgv),
      engineerPrismaGenerateInnerArgv(),
      nonceAuthorityInnerArgv(["corepack", "pnpm", "lint"]),
      nonceAuthorityInnerArgv(["corepack", "pnpm", "typecheck"]),
      nonceAuthorityInnerArgv(["corepack", "pnpm", "test"]),
      nonceAuthorityInnerArgv(["corepack", "pnpm", "build"]),
      ["bash", "scripts/run-workspace-runtime.sh", "root", "--", "corepack", "pnpm", "build"],
    ]);
  });

  it("aborts U076 before the root build when engineer Prisma generation fails", async () => {
    const argv = [];
    const ctx = {
      makeChildEnv: () => ({}),
      spawnInMirror: async (command) => {
        argv.push(command);
        return JSON.stringify(command) === JSON.stringify(engineerPrismaGenerateInnerArgv())
          ? { code: 1, stdout: "", stderr: "missing generated Prisma client" }
          : { code: 0, stdout: "", stderr: "" };
      },
    };

    await assert.rejects(
      runU076CleanMirrorBootstrap(ctx),
      (error) => error?.exitCode === 65 && /u076 engineer Prisma generate failed: missing generated Prisma client/.test(error.message),
    );
    assert.deepEqual(argv, [
      ...["root", "engineer", "workflow", "nonce"].map(frozenInstallInnerArgv),
      engineerPrismaGenerateInnerArgv(),
    ]);
  });

  it("fails closed before root build when the standalone nonce test has no parseable test evidence", async () => {
    const argv = [];
    const ctx = {
      makeChildEnv: () => ({}),
      spawnInMirror: async (command) => {
        argv.push(command);
        return { code: 0, stdout: "", stderr: "" };
      },
    };

    await assert.rejects(
      runU076CleanMirrorBootstrap(ctx),
      (error) => error?.exitCode === 65 && /u076 nonce-unit failed: unparseable_output/.test(error.message),
    );
    assert.deepEqual(argv, [
      ...["root", "engineer", "workflow", "nonce"].map(frozenInstallInnerArgv),
      engineerPrismaGenerateInnerArgv(),
      nonceAuthorityInnerArgv(["corepack", "pnpm", "lint"]),
      nonceAuthorityInnerArgv(["corepack", "pnpm", "typecheck"]),
      nonceAuthorityInnerArgv(["corepack", "pnpm", "test"]),
    ]);
  });
  it("exit 64 on missing required args / bad mode", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    assert.equal(r.status, 64);
    const r2 = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--mode",
        "nope",
        "--candidate-sha",
        HEAD,
        "--run-id",
        "r",
        "--owner-unit",
        "U007",
        "--attempt-dir",
        "/tmp/x",
        "--resource-lease-file",
        "/tmp/y",
      ],
      { encoding: "utf8" },
    );
    assert.equal(r2.status, 64);
  });

  it("deriveRunnerContractChecks never hard-codes PASS", () => {
    const empty = deriveRunnerContractChecks({});
    assert.equal(empty.runner_contract_status, "FAIL");
    assert.equal(empty.checks.scratchPostgres, "FAIL");

    const oneFail = deriveRunnerContractChecks({
      manifest19Lanes: { ok: true },
      strictResultParser: { ok: true },
      falseGreenFixtures: { ok: true },
      sanitizedEnv: { ok: true },
      scratchPostgres: { ok: false },
      apiProductionStart: { ok: true },
      playwrightCoreFlow: { ok: true },
      detachedMirrorCleanup: { ok: true },
    });
    assert.equal(oneFail.runner_contract_status, "FAIL");
    assert.equal(oneFail.checks.scratchPostgres, "FAIL");
    assert.equal(oneFail.checks.manifest19Lanes, "PASS");

    const all = deriveRunnerContractChecks({
      manifest19Lanes: { ok: true },
      strictResultParser: { ok: true },
      falseGreenFixtures: { ok: true },
      sanitizedEnv: { ok: true },
      scratchPostgres: { ok: true },
      apiProductionStart: { ok: true },
      playwrightCoreFlow: { ok: true },
      detachedMirrorCleanup: { ok: true },
    });
    assert.equal(all.runner_contract_status, "PASS");
    for (const v of Object.values(all.checks)) assert.equal(v, "PASS");
  });

  it("evaluateNodeTestTap is strict on TAP footer (ignores fixture body phrases)", () => {
    const green = evaluateNodeTestTap({
      code: 0,
      stdout: [
        "ok 1 - something mentioning No tests in a fixture string",
        "# tests 3",
        "# pass 3",
        "# fail 0",
        "# skipped 0",
        "# todo 0",
      ].join("\n"),
      stderr: "",
    });
    assert.equal(green.ok, true);
    assert.equal(green.counts.total, 3);

    const zero = evaluateNodeTestTap({
      code: 0,
      stdout: "# tests 0\n# pass 0\n# fail 0\n",
      stderr: "",
    });
    assert.equal(zero.ok, false);
    assert.equal(zero.reason, "zero_tests");

    const failed = evaluateNodeTestTap({
      code: 1,
      stdout: "# tests 2\n# pass 1\n# fail 1\n",
      stderr: "",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, "nonzero_exit");
  });

  it(
    "stubbed sub-step FAIL → runner_contract_status != PASS and exit !== 78",
    { timeout: 120_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "u007-fail-"));
      chmodSync(dir, 0o700);
      const lease = writeLease(dir, { runId: "run-fail-stub" });
      const attempt = join(dir, "attempt");
      try {
        const code = await captureExit(() =>
          runDetachedReleaseMirrorMain(
            [
              "--mode",
              "u007-release",
              "--candidate-sha",
              HEAD,
              "--run-id",
              "run-fail-stub",
              "--owner-unit",
              "U007",
              "--attempt-dir",
              attempt,
              "--resource-lease-file",
              lease,
            ],
            {
              falseGreenScan: historicalPreU030Scan(),
              inject: allPassInject({
                // Real derivation path: one stubbed failure must flip status
                scratchPostgres: {
                  ok: false,
                  detail: { reason: "stubbed_substep_failure" },
                },
              }),
            },
          ),
        );
        assert.notEqual(code, 78, "FAIL path must not publish exit 78");
        assert.equal(code, 65);
        assert.ok(existsSync(join(attempt, "runner-contract-receipt.json")));
        const runner = JSON.parse(
          readFileSync(join(attempt, "runner-contract-receipt.json"), "utf8"),
        );
        assert.equal(runner.schemaVersion, 2);
        assert.equal(runner.runner_contract_status, "FAIL");
        assert.equal(runner.checks.scratchPostgres, "FAIL");
        // Other injected steps still PASS — proves per-check derivation
        assert.equal(runner.checks.manifest19Lanes, "PASS");
        assert.equal(runner.checks.sanitizedEnv, "PASS");
        const product = JSON.parse(
          readFileSync(join(attempt, "product-release-receipt.json"), "utf8"),
        );
        assert.equal(product.schemaVersion, 2);
        assert.equal(product.product_release_status, "RED_EXPECTED");
        assert.equal(product.outerExitCode, 65);
        assert.notEqual(product.outerExitCode, 78);
      } finally {
        spawnSync("git", ["worktree", "prune", "--expire", "now"]);
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it(
    "all real-derived checks PASS (injected outcomes) → exit 78 + dual receipts",
    { timeout: 120_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "u007-pass-"));
      chmodSync(dir, 0o700);
      const lease = writeLease(dir, { runId: "run-pass-stub" });
      const attempt = join(dir, "attempt");
      try {
        const code = await captureExit(() =>
          runDetachedReleaseMirrorMain(
            [
              "--mode",
              "u007-release",
              "--candidate-sha",
              HEAD,
              "--run-id",
              "run-pass-stub",
              "--owner-unit",
              "U007",
              "--attempt-dir",
              attempt,
              "--resource-lease-file",
              lease,
            ],
            {
              falseGreenScan: historicalPreU030Scan(),
              // Leave detachedMirrorCleanup un-injected → real mirror cleanup
              inject: allPassInject(),
            },
          ),
        );
        assert.equal(code, 78);
        assert.ok(existsSync(join(attempt, "runner-contract-receipt.json")));
        assert.ok(existsSync(join(attempt, "product-release-receipt.json")));
        assert.ok(existsSync(join(attempt, "runner-contract-receipt.sha256")));
        assert.ok(existsSync(join(attempt, "product-release-receipt.sha256")));
        const runner = JSON.parse(
          readFileSync(join(attempt, "runner-contract-receipt.json"), "utf8"),
        );
        assert.equal(runner.schemaVersion, 2);
        assert.equal(runner.runner_contract_status, "PASS");
        for (const [k, v] of Object.entries(runner.checks)) {
          assert.equal(v, "PASS", k);
        }
        // Mirror receipt enriched with inject-populated build/start/playwright
        const mirror = JSON.parse(
          readFileSync(join(attempt, "detached-release-mirror-receipt.json"), "utf8"),
        );
        assert.ok(mirror.build === null || typeof mirror.build === "object");
        assert.ok(mirror.start === null || typeof mirror.start === "object");
        assert.equal(mirror.cleanup.status, "PASS");
        const product = JSON.parse(
          readFileSync(join(attempt, "product-release-receipt.json"), "utf8"),
        );
        assert.equal(product.schemaVersion, 2);
        assert.equal(product.product_release_status, "RED_EXPECTED");
        assert.equal(product.outerExitCode, 78);
        assert.equal(product.preflightBlockers.length, 1);
        assert.equal(product.preflightBlockers[0].package, "@sangfor/ui");
        assert.equal(product.cleanupStatus, "PASS");
        const checker = spawnSync(
          process.execPath,
          [
            RECEIPT_CHECKER,
            "--phase",
            "pre_u030",
            "--runner",
            join(attempt, "runner-contract-receipt.json"),
            "--product",
            join(attempt, "product-release-receipt.json"),
          ],
          { encoding: "utf8" },
        );
        assert.equal(checker.status, 0, checker.stderr + checker.stdout);
        assert.equal(existsSync(join(attempt, "source")), false);
      } finally {
        spawnSync("git", ["worktree", "prune", "--expire", "now"]);
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
