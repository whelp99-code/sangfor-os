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
const SCHEMA = join(HERE, "release-state-receipt.schema.json");
const HEAD = "a".repeat(40);
const V2_STEP_IDS = [
  "root-lint",
  "root-typecheck",
  "root-unit",
  "root-integration",
  "root-build",
  "engineer-lint",
  "engineer-typecheck",
  "engineer-unit",
  "engineer-integration",
  "engineer-build",
  "workflow-lint",
  "workflow-typecheck",
  "workflow-unit",
  "workflow-integration",
  "workflow-build",
  "nonce-lint",
  "nonce-typecheck",
  "nonce-unit",
  "nonce-build",
];

function writeJson(dir, file, value) {
  const path = join(dir, file);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, body);
  return { path, hash: createHash("sha256").update(body).digest("hex") };
}

function writePair(dir, { phase = "pre_u030", schemaVersion = phase === "post_u030" ? 2 : 1, mutateRunner, mutateProduct } = {}) {
  const post = phase === "post_u030";
  const current = schemaVersion === 2;
  const runner = {
    schemaVersion,
    receiptKind: "runner_contract",
    phase,
    unit: post ? "U030" : "U007",
    runId: "run-1",
    candidateSha: HEAD,
    releaseManifestSha256: "b".repeat(64),
    releaseSchemaSha256: "c".repeat(64),
    detachedMirrorReceiptSha256: "d".repeat(64),
    checks: {
      [current ? "manifest19Lanes" : "manifest15Lanes"]: "PASS",
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
  const { path: runnerPath, hash: runnerHash } = writeJson(
    dir,
    "runner-contract-receipt.json",
    runner,
  );
  writeFileSync(join(dir, "runner-contract-receipt.sha256"), `${runnerHash}\n`);

  const references = post
    ? {
        previous: writeJson(dir, "previous-product.json", { receipt: "previous" }),
        inventory: writeJson(dir, "u008-inventory.json", { receipt: "inventory" }),
        u029: writeJson(dir, "u029.json", { receipt: "u029" }),
      }
    : null;
  const product = {
    schemaVersion,
    receiptKind: "product_release",
    phase,
    unit: post ? "U030" : "U007",
    runId: "run-1",
    candidateSha: HEAD,
    runnerContractReceiptSha256: runnerHash,
    previousProductReleaseReceiptSha256: references?.previous.hash ?? null,
    u008InventoryReceiptSha256: references?.inventory.hash ?? null,
    u029ReceiptSha256: references?.u029.hash ?? null,
    releaseManifestSha256: "b".repeat(64),
    releaseSchemaSha256: "c".repeat(64),
    product_release_status: post ? "PASS" : "RED_EXPECTED",
    preflightBlockers: post ? [] : [
      {
        code: "FALSE_GREEN_TEST_SCRIPT",
        package: "@sangfor/ui",
        path: "packages/ui/package.json",
        script: "echo No tests",
      },
    ],
    completedStepIds: post ? [...V2_STEP_IDS] : [],
    failedStepIds: [],
    releaseExitCode: post ? 0 : 64,
    outerExitCode: post ? 0 : 78,
    releaseReportSha256: "e".repeat(64),
    cleanupStatus: "PASS",
    createdAt: new Date().toISOString(),
  };
  if (mutateProduct) mutateProduct(product);
  const { path: productPath, hash: productHash } = writeJson(
    dir,
    "product-release-receipt.json",
    product,
  );
  writeFileSync(
    join(dir, "product-release-receipt.sha256"),
    `${productHash}\n`,
  );
  return { runnerPath, productPath, references };
}

function checkerArgs({ runnerPath, productPath, references }, phase) {
  const args = [CHECKER, "--phase", phase, "--runner", runnerPath, "--product", productPath];
  if (phase === "post_u030") {
    args.push(
      "--previous-product", references.previous.path,
      "--inventory", references.inventory.path,
      "--u029", references.u029.path,
    );
  }
  return args;
}

describe("release-state-receipt", () => {
  it("historical pre_u030 v1 pair PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "u007-rs-"));
    try {
      const { runnerPath, productPath } = writePair(dir);
      const r = spawnSync(
        process.execPath,
        checkerArgs({ runnerPath, productPath }, "pre_u030"),
        { encoding: "utf8" },
      );
      assert.equal(r.status, 0, r.stderr + r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("current pre_u030 v2 pair with manifest19Lanes PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "u007-rs-v2-"));
    try {
      const pair = writePair(dir, { schemaVersion: 2 });
      const r = spawnSync(process.execPath, checkerArgs(pair, "pre_u030"), {
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr + r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("schema retains historical v1 post_u030/U030 structural acceptance", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
    const v1Branches = schema.oneOf.filter(
      (branch) => branch.properties.schemaVersion.const === 1,
    );
    assert.equal(v1Branches.length, 2);
    for (const branch of v1Branches) {
      assert.deepEqual(branch.properties.phase.enum, ["pre_u030", "post_u030"]);
      assert.deepEqual(branch.properties.unit.enum, ["U007", "U030"]);
    }
  });

  it("schema defines distinct current v2 U007/pre_u030 receipt branches", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
    const currentPreBranches = schema.oneOf.filter(
      (branch) =>
        branch.properties.schemaVersion.const === 2 &&
        branch.properties.phase.const === "pre_u030" &&
        branch.properties.unit.const === "U007",
    );
    assert.equal(currentPreBranches.length, 2);
    const runner = currentPreBranches.find(
      (branch) => branch.properties.receiptKind.const === "runner_contract",
    );
    assert.ok(runner);
    assert.ok(runner.properties.checks.required.includes("manifest19Lanes"));
  });

  it("post_u030 v2 receipt with exact ordered 19 lanes PASS", () => {
    const dir = mkdtempSync(join(tmpdir(), "u030-rs-"));
    try {
      const pair = writePair(dir, { phase: "post_u030" });
      const r = spawnSync(process.execPath, checkerArgs(pair, "post_u030"), {
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr + r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("post_u030 rejects a valid-looking historical 15-step receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "u030-rs-15-step-"));
    try {
      const pair = writePair(dir, {
        phase: "post_u030",
        mutateProduct: (product) => {
          product.completedStepIds = V2_STEP_IDS.slice(0, 15);
        },
      });
      const r = spawnSync(process.execPath, checkerArgs(pair, "post_u030"), {
        encoding: "utf8",
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /completedStepIds exact ordered 19/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("post_u030 rejects v1 receipts before production or cutover authorization", () => {
    const dir = mkdtempSync(join(tmpdir(), "u030-rs-v1-"));
    try {
      const pair = writePair(dir, {
        phase: "post_u030",
        mutateRunner: (runner) => {
          runner.schemaVersion = 1;
          runner.checks = {
            ...runner.checks,
            manifest15Lanes: runner.checks.manifest19Lanes,
          };
          delete runner.checks.manifest19Lanes;
        },
        mutateProduct: (product) => {
          product.schemaVersion = 1;
        },
      });
      const r = spawnSync(process.execPath, checkerArgs(pair, "post_u030"), {
        encoding: "utf8",
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /runner schemaVersion/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pre_u030 rejects version/key mismatches between historical and current contracts", () => {
    const cases = [
      {
        name: "v2 receipt with historical 15-lane key",
        options: {
          schemaVersion: 2,
          mutateRunner: (runner) => {
            runner.checks.manifest15Lanes = runner.checks.manifest19Lanes;
            delete runner.checks.manifest19Lanes;
          },
        },
        expected: /checks: key set mismatch/,
      },
      {
        name: "v1 receipt with current 19-lane key",
        options: {
          mutateRunner: (runner) => {
            runner.checks.manifest19Lanes = runner.checks.manifest15Lanes;
            delete runner.checks.manifest15Lanes;
          },
        },
        expected: /checks: key set mismatch/,
      },
      {
        name: "mixed v1 runner and v2 product",
        options: {
          mutateProduct: (product) => { product.schemaVersion = 2; },
        },
        expected: /product schemaVersion/,
      },
    ];
    for (const { name, options, expected } of cases) {
      const dir = mkdtempSync(join(tmpdir(), "u007-rs-version-key-"));
      try {
        const pair = writePair(dir, options);
        const r = spawnSync(process.execPath, checkerArgs(pair, "pre_u030"), {
          encoding: "utf8",
        });
        assert.notEqual(r.status, 0, name);
        assert.match(r.stderr, expected, name);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("post_u030 rejects reordered, duplicate, and extra lanes", () => {
    for (const completedStepIds of [
      [...V2_STEP_IDS].reverse(),
      [...V2_STEP_IDS.slice(0, -1), V2_STEP_IDS.at(-2)],
      [...V2_STEP_IDS, "unexpected-step"],
    ]) {
      const dir = mkdtempSync(join(tmpdir(), "u030-rs-nonexact-"));
      try {
        const pair = writePair(dir, {
          phase: "post_u030",
          mutateProduct: (product) => { product.completedStepIds = completedStepIds; },
        });
        const r = spawnSync(process.execPath, checkerArgs(pair, "post_u030"), {
          encoding: "utf8",
        });
        assert.notEqual(r.status, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
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
