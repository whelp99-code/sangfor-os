/**
 * U007 — dual release-state receipt checker.
 * argv: --phase pre_u030|post_u030 --runner <abs> --product <abs>
 * post also: --previous-product --inventory --u029
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRE_BLOCKER = {
  code: "FALSE_GREEN_TEST_SCRIPT",
  package: "@sangfor/ui",
  path: "packages/ui/package.json",
  script: "echo No tests",
};

const STEP_IDS = [
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
];

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`unexpected arg ${a}`);
    const key = a.slice(2);
    const val = argv[++i];
    if (val === undefined) fail(`missing value for --${key}`);
    out[key] = val;
  }
  return out;
}

function loadJson(abs) {
  if (!abs.startsWith("/")) fail(`path must be absolute: ${abs}`);
  if (!existsSync(abs)) fail(`missing file: ${abs}`);
  return JSON.parse(readFileSync(abs, "utf8"));
}

function assertSidecar(jsonPath) {
  const sidecar = jsonPath.replace(/\.json$/, ".sha256");
  if (!existsSync(sidecar)) fail(`missing sidecar ${sidecar}`);
  const expected = readFileSync(sidecar, "utf8").trim();
  const actual = sha256File(jsonPath);
  if (expected !== actual) {
    fail(`sidecar hash mismatch for ${jsonPath}`);
  }
  if (!/^[0-9a-f]{64}$/.test(actual)) fail("hash format");
  return actual;
}

function assertExactKeys(obj, keys, label) {
  const got = Object.keys(obj).sort();
  const exp = [...keys].sort();
  if (got.length !== exp.length || got.some((k, i) => k !== exp[i])) {
    fail(`${label}: key set mismatch got=${got.join(",")} exp=${exp.join(",")}`);
  }
}

export function checkReleaseStateReceipts(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const phase = args.phase;
  if (phase !== "pre_u030" && phase !== "post_u030") {
    fail("--phase pre_u030|post_u030 required");
  }
  if (!args.runner || !args.product) {
    fail("--runner and --product required");
  }
  if (phase === "post_u030") {
    for (const k of ["previous-product", "inventory", "u029"]) {
      if (!args[k]) fail(`post_u030 requires --${k}`);
    }
  } else {
    for (const k of ["previous-product", "inventory", "u029"]) {
      if (args[k]) fail(`pre_u030 rejects --${k}`);
    }
  }

  const runnerPath = resolve(args.runner);
  const productPath = resolve(args.product);
  const runnerHash = assertSidecar(runnerPath);
  const productHash = assertSidecar(productPath);
  const runner = loadJson(runnerPath);
  const product = loadJson(productPath);

  // Runner receipt
  assertExactKeys(
    runner,
    [
      "schemaVersion",
      "receiptKind",
      "phase",
      "unit",
      "runId",
      "candidateSha",
      "releaseManifestSha256",
      "releaseSchemaSha256",
      "detachedMirrorReceiptSha256",
      "checks",
      "runner_contract_status",
      "createdAt",
    ],
    "runner",
  );
  if (runner.schemaVersion !== 1) fail("runner schemaVersion");
  if (runner.receiptKind !== "runner_contract") fail("runner receiptKind");
  if (runner.runner_contract_status !== "PASS") fail("runner_contract_status");
  if (runner.phase !== phase) fail("runner phase");
  if (phase === "pre_u030" && runner.unit !== "U007") fail("pre unit");
  if (phase === "post_u030" && runner.unit !== "U030") fail("post unit");
  if (!/^[0-9a-f]{40}$/.test(runner.candidateSha)) fail("candidateSha");
  for (const h of [
    "releaseManifestSha256",
    "releaseSchemaSha256",
    "detachedMirrorReceiptSha256",
  ]) {
    if (!/^[0-9a-f]{64}$/.test(runner[h])) fail(`${h} format`);
  }
  const checkKeys = [
    "manifest15Lanes",
    "strictResultParser",
    "falseGreenFixtures",
    "sanitizedEnv",
    "scratchPostgres",
    "apiProductionStart",
    "playwrightCoreFlow",
    "detachedMirrorCleanup",
  ];
  assertExactKeys(runner.checks, checkKeys, "checks");
  for (const k of checkKeys) {
    if (runner.checks[k] !== "PASS") fail(`check ${k} not PASS`);
  }

  // Product receipt
  assertExactKeys(
    product,
    [
      "schemaVersion",
      "receiptKind",
      "phase",
      "unit",
      "runId",
      "candidateSha",
      "runnerContractReceiptSha256",
      "previousProductReleaseReceiptSha256",
      "u008InventoryReceiptSha256",
      "u029ReceiptSha256",
      "releaseManifestSha256",
      "releaseSchemaSha256",
      "product_release_status",
      "preflightBlockers",
      "completedStepIds",
      "failedStepIds",
      "releaseExitCode",
      "outerExitCode",
      "releaseReportSha256",
      "cleanupStatus",
      "createdAt",
    ],
    "product",
  );
  if (product.schemaVersion !== 1) fail("product schemaVersion");
  if (product.receiptKind !== "product_release") fail("product receiptKind");
  if (product.phase !== phase) fail("product phase");
  if (product.runId !== runner.runId) fail("runId mismatch");
  if (product.candidateSha !== runner.candidateSha) fail("candidateSha mismatch");
  if (product.releaseManifestSha256 !== runner.releaseManifestSha256) {
    fail("manifest hash mismatch");
  }
  if (product.releaseSchemaSha256 !== runner.releaseSchemaSha256) {
    fail("schema hash mismatch");
  }
  if (product.runnerContractReceiptSha256 !== runnerHash) {
    fail("runnerContractReceiptSha256 mismatch");
  }
  if (product.cleanupStatus !== "PASS") fail("cleanupStatus");

  if (phase === "pre_u030") {
    if (product.unit !== "U007") fail("pre product unit");
    if (product.product_release_status !== "RED_EXPECTED") fail("RED_EXPECTED");
    if (product.previousProductReleaseReceiptSha256 !== null) fail("prev null");
    if (product.u008InventoryReceiptSha256 !== null) fail("u008 null");
    if (product.u029ReceiptSha256 !== null) fail("u029 null");
    if (product.completedStepIds.length !== 0) fail("completedStepIds empty");
    if (product.failedStepIds.length !== 0) fail("failedStepIds empty");
    if (product.releaseExitCode !== 64) fail("releaseExitCode 64");
    if (product.outerExitCode !== 78) fail("outerExitCode 78");
    if (!Array.isArray(product.preflightBlockers) || product.preflightBlockers.length !== 1) {
      fail("exactly one preflightBlocker");
    }
    const b = product.preflightBlockers[0];
    for (const k of Object.keys(PRE_BLOCKER)) {
      if (b[k] !== PRE_BLOCKER[k]) fail(`blocker field ${k}`);
    }
    for (const k of Object.keys(b)) {
      if (!(k in PRE_BLOCKER)) fail(`blocker extra field ${k}`);
    }
  } else {
    if (product.unit !== "U030") fail("post product unit");
    if (product.product_release_status !== "PASS") fail("PASS");
    if (product.product_release_status === "RED_EXPECTED") fail("no RED after U030");
    if (!product.previousProductReleaseReceiptSha256) fail("previous required");
    if (!product.u008InventoryReceiptSha256) fail("inventory required");
    if (!product.u029ReceiptSha256) fail("u029 required");
    if (JSON.stringify(product.completedStepIds) !== JSON.stringify(STEP_IDS)) {
      fail("completedStepIds exact 15");
    }
    if (product.failedStepIds.length !== 0) fail("failedStepIds empty");
    if (product.preflightBlockers.length !== 0) fail("blockers empty");
    if (product.releaseExitCode !== 0) fail("releaseExitCode 0");
    if (product.outerExitCode !== 0) fail("outerExitCode 0");
    // chain hashes against provided files
    const prevHash = sha256File(resolve(args["previous-product"]));
    if (product.previousProductReleaseReceiptSha256 !== prevHash) {
      fail("previous product hash mismatch");
    }
    const invHash = sha256File(resolve(args.inventory));
    if (product.u008InventoryReceiptSha256 !== invHash) {
      fail("inventory hash mismatch");
    }
    const u029Hash = sha256File(resolve(args.u029));
    if (product.u029ReceiptSha256 !== u029Hash) {
      fail("u029 hash mismatch");
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        phase,
        runnerHash,
        productHash,
      },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    checkReleaseStateReceipts();
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
