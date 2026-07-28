/**
 * U003 — check-runtime-contract fixtures (node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  buildContext,
  checkBaselineIsAncestor,
  checkCiSetup,
  checkOutputContract,
  checkPortConsistency,
  checkRuntimeMatrix,
  checkSingleLockfilePerWorkspace,
  runAllChecks,
} from "./check-runtime-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BASELINE = "081a1c0c708104f7d0dd50667a261ea84e9ce85c";

/** @type {string[]} */
const TEMPS = [];
function tempDir() {
  const d = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "sangfor-u003."));
  TEMPS.push(d);
  return d;
}
function cleanup() {
  for (const d of TEMPS.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    assert.equal(existsSync(d), false);
  }
}
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"]) {
  process.on(s, () => {
    cleanup();
    process.exit(1);
  });
}

test("dual-lockfile inventory fails single-lockfile-per-workspace", () => {
  const ctx = buildContext({
    root: REPO,
    baseline: BASELINE,
    lockfileInventory: [
      "pnpm-lock.yaml",
      "services/sangfor-engineer-mcp/pnpm-lock.yaml",
      "services/sangfor-engineer-mcp/package-lock.json",
      "services/sangfor-mcp-workflow/pnpm-lock.yaml",
    ].join("\n"),
  });
  const r = checkSingleLockfilePerWorkspace(ctx);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /package-lock\.json/);
});

test("disjoint nvmrc/engines fails runtime-matrix", () => {
  const d = tempDir();
  // Minimal tree with wrong matrix
  mkdirSync(join(d, "services/sangfor-engineer-mcp"), { recursive: true });
  mkdirSync(join(d, "services/sangfor-mcp-workflow"), { recursive: true });
  for (const [rel, nvm, eng, name, pm] of [
    [".", "18", ">=18 <19", "sangfor-agentic-os", "pnpm@10.28.1"],
    ["services/sangfor-engineer-mcp", "20", ">=22 <23", "sangfor-engineer-mcp", "pnpm@10.28.1"],
    ["services/sangfor-mcp-workflow", "22", ">=22 <23", "sangfor-mcp-workflow", "pnpm@10.28.1"],
  ]) {
    writeFileSync(join(d, rel, ".nvmrc"), `${nvm}\n`);
    writeFileSync(
      join(d, rel, "package.json"),
      JSON.stringify({ name, packageManager: pm, engines: { node: eng } }, null, 2) + "\n",
    );
  }
  const r = checkRuntimeMatrix(buildContext({ root: d, baseline: BASELINE }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /nvmrc|engines/i);
});

test("duplicate port fails port-consistency", () => {
  const d = tempDir();
  mkdirSync(join(d, "packages/config/src"), { recursive: true });
  writeFileSync(
    join(d, "packages/config/src/ports.ts"),
    `export const PORT_REGISTRY = {
  SANGFOR_WEB: 3101,
  SANGFOR_API: 3200,
  SANGFOR_MCP: 3500,
  SANGFOR_MOCK_CONSOLE: 3400,
  WHELP99_MCP_BRIDGE: 3600,
  WHELP99_OPERATOR_CONSOLE: 3502,
  SANGFOR_POSTGRES: 5434,
  SANGFOR_REDIS: 6380,
} as const;
`,
  );
  writeFileSync(
    join(d, "PORT-MAPPING.yaml"),
    `services:
  web:
    port: 3101
  api:
    port: 3101
  sangfor-mcp-workflow:
    port: 3500
  sangfor-mcp-mock-console:
    port: 3400
  sangfor-engineer-mcp:
    port: 3600
  sangfor-operator-console:
    port: 3502
  postgres:
    port: 5434
  redis:
    port: 6380
`,
  );
  writeFileSync(join(d, "docker-compose.yml"), "services: {}\n");
  const r = checkPortConsistency(buildContext({ root: d, baseline: BASELINE }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /duplicate|want/);
});

test("output escape via ../ fails output-contract", () => {
  const r = checkOutputContract(
    buildContext({
      root: REPO,
      baseline: BASELINE,
      outputRoots: {
        root: "../outside-outputs/",
        engineer: "services/sangfor-engineer-mcp/outputs/",
        workflow: "services/sangfor-mcp-workflow/outputs/",
      },
    }),
  );
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /\.\.|escape|not inside/i);
});

test("wrong CI fails ci-setup", () => {
  const d = tempDir();
  mkdirSync(join(d, ".github/workflows"), { recursive: true });
  writeFileSync(
    join(d, ".github/workflows/ci.yml"),
    `jobs:
  static-checks:
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
`,
  );
  writeFileSync(
    join(d, ".github/workflows/services-ci.yml"),
    `jobs:
  engineer-mcp:
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
`,
  );
  const r = checkCiSetup(buildContext({ root: d, baseline: BASELINE }));
  assert.equal(r.status, "FAIL");
});

test("non-ancestor baseline fails baseline-is-ancestor", () => {
  const r = checkBaselineIsAncestor(
    buildContext({ root: REPO, baseline: "0000000000000000000000000000000000000001" }),
  );
  assert.equal(r.status, "FAIL");
});

test("green path on real repo (after U003 files present)", () => {
  // This test is expected GREEN only once all U003 artifacts exist.
  const script = join(REPO, "scripts", "check-runtime-contract.mjs");
  assert.ok(existsSync(script));
  const r = spawnSync(
    process.execPath,
    [script, "--baseline", BASELINE],
    { cwd: REPO, encoding: "utf8" },
  );
  // During RED of full contract this may FAIL; assert structure at minimum.
  // Once complete, overall must be PASS.
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    assert.fail(`invalid JSON report: ${r.stdout}\n${r.stderr}`);
  }
  assert.equal(report.unit, "U003");
  assert.ok(Array.isArray(report.checks));
  assert.equal(report.checks.length, 8);
  if (report.overall !== "PASS") {
    // Surface which checks still fail (helps iteration)
    const failed = report.checks.filter((c) => c.status === "FAIL").map((c) => `${c.name}: ${c.detail}`);
    assert.fail(`overall FAIL:\n${failed.join("\n")}`);
  }
  assert.equal(r.status, 0);
});
