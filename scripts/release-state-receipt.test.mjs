import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, "check-release-state-receipts.mjs");
const HEAD = "a".repeat(40);

function writePair(dir, { mutateRunner, mutateProduct } = {}) {
  const runner = {
    schemaVersion: 1,
    receiptKind: "runner_contract",
    phase: "pre_u030",
    unit: "U007",
    runId: "run-1",
    candidateSha: HEAD,
    releaseManifestSha256: "b".repeat(64),
    releaseSchemaSha256: "c".repeat(64),
    detachedMirrorReceiptSha256: "d".repeat(64),
    checks: {
      manifest15Lanes: "PASS",
      strictResultParser: "PASS",
      falseGreenFixtures: "PASS",
      sanitizedEnv: "PASS",
      scratchPostgres: "PASS",
      apiProductionStart: "PASS",
      playwrightCoreFlow: "PASS",
      detachedMirrorCleanup: "PASS",
    },
    runner_contract_status: "PASS",
    createdAt: new Date().toISOString(),
  };
  if (mutateRunner) mutateRunner(runner);
  const runnerPath = join(dir, "runner-contract-receipt.json");
  const runnerBody = `${JSON.stringify(runner, null, 2)}\n`;
  writeFileSync(runnerPath, runnerBody);
  const runnerHash = createHash("sha256").update(runnerBody).digest("hex");
  writeFileSync(join(dir, "runner-contract-receipt.sha256"), `${runnerHash}\n`);

  const product = {
    schemaVersion: 1,
    receiptKind: "product_release",
    phase: "pre_u030",
    unit: "U007",
    runId: "run-1",
    candidateSha: HEAD,
    runnerContractReceiptSha256: runnerHash,
    previousProductReleaseReceiptSha256: null,
    u008InventoryReceiptSha256: null,
    u029ReceiptSha256: null,
    releaseManifestSha256: "b".repeat(64),
    releaseSchemaSha256: "c".repeat(64),
    product_release_status: "RED_EXPECTED",
    preflightBlockers: [
      {
        code: "FALSE_GREEN_TEST_SCRIPT",
        package: "@sangfor/ui",
        path: "packages/ui/package.json",
        script: "echo No tests",
      },
    ],
    completedStepIds: [],
    failedStepIds: [],
    releaseExitCode: 64,
    outerExitCode: 78,
    releaseReportSha256: "e".repeat(64),
    cleanupStatus: "PASS",
    createdAt: new Date().toISOString(),
  };
  if (mutateProduct) mutateProduct(product);
  const productPath = join(dir, "product-release-receipt.json");
  const productBody = `${JSON.stringify(product, null, 2)}\n`;
  writeFileSync(productPath, productBody);
  const productHash = createHash("sha256").update(productBody).digest("hex");
  writeFileSync(
    join(dir, "product-release-receipt.sha256"),
    `${productHash}\n`,
  );
  return { runnerPath, productPath };
}

describe("release-state-receipt", () => {
  it("pre_u030 valid pair PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "u007-rs-"));
    try {
      const { runnerPath, productPath } = writePair(dir);
      const r = spawnSync(
        process.execPath,
        [
          CHECKER,
          "--phase",
          "pre_u030",
          "--runner",
          runnerPath,
          "--product",
          productPath,
        ],
        { encoding: "utf8" },
      );
      assert.equal(r.status, 0, r.stderr + r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing ui blocker / PASS status / exit 0", () => {
    for (const mut of [
      (p) => {
        p.preflightBlockers = [];
      },
      (p) => {
        p.product_release_status = "PASS";
      },
      (p) => {
        p.outerExitCode = 0;
      },
      (p) => {
        p.preflightBlockers.push({
          code: "X",
          package: "y",
          path: "z",
          script: "s",
        });
      },
    ]) {
      const dir = mkdtempSync(join(tmpdir(), "u007-rs-bad-"));
      try {
        const { runnerPath, productPath } = writePair(dir, {
          mutateProduct: mut,
        });
        // re-hash product after mutate — writePair already wrote; need rewrite
        // Actually mutateProduct runs before write, so OK
        const r = spawnSync(
          process.execPath,
          [
            CHECKER,
            "--phase",
            "pre_u030",
            "--runner",
            runnerPath,
            "--product",
            productPath,
          ],
          { encoding: "utf8" },
        );
        assert.notEqual(r.status, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("rejects runner check FAIL", () => {
    const dir = mkdtempSync(join(tmpdir(), "u007-rs-r-"));
    try {
      const { runnerPath, productPath } = writePair(dir, {
        mutateRunner: (r) => {
          r.checks.strictResultParser = "FAIL";
        },
      });
      const r = spawnSync(
        process.execPath,
        [
          CHECKER,
          "--phase",
          "pre_u030",
          "--runner",
          runnerPath,
          "--product",
          productPath,
        ],
        { encoding: "utf8" },
      );
      assert.notEqual(r.status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
