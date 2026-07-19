import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  discoverAllUsed,
  discoverEngineerMcpTools,
  discoverWorkflowMcpTools,
  validateInventory,
  validateReleasePrerequisite,
} from "./check-entrypoint-inventory.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY_PATH = resolve(repoRoot, "docs/12_VERIFICATION/entrypoint-inventory.json");
const U007_DIR = resolve(
  repoRoot,
  "../sangfor-os/.omo/evidence/sangfor-system-refactor-2026-07-15/U007/attempt-1",
);
const REAL_ENV = {
  U007_RUNNER_CONTRACT_RECEIPT_FILE: resolve(U007_DIR, "runner-contract-receipt.json"),
  U007_PRODUCT_RELEASE_RECEIPT_FILE: resolve(U007_DIR, "product-release-receipt.json"),
};

async function withTmpDir(prefix, run) {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withMutatedInventory(mutate, run) {
  return withTmpDir("u008-inventory-fixture-", (dir) => {
    const original = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
    const mutated = mutate(structuredClone(original));
    const path = resolve(dir, "entrypoint-inventory.json");
    writeFileSync(path, JSON.stringify(mutated, null, 2));
    return run(validateInventory(repoRoot, path));
  });
}

function copyU007Fixture(dir, mutateProduct, { skipRunner = false } = {}) {
  const runnerContent = readFileSync(REAL_ENV.U007_RUNNER_CONTRACT_RECEIPT_FILE);
  const runnerDst = resolve(dir, "runner-contract-receipt.json");
  if (!skipRunner) {
    writeFileSync(runnerDst, runnerContent);
    writeFileSync(resolve(dir, "runner-contract-receipt.sha256"), createHash("sha256").update(runnerContent).digest("hex"));
  }

  const product = JSON.parse(readFileSync(REAL_ENV.U007_PRODUCT_RELEASE_RECEIPT_FILE, "utf8"));
  if (mutateProduct) mutateProduct(product, runnerContent);
  const productContent = Buffer.from(`${JSON.stringify(product, null, 2)}\n`);
  const productDst = resolve(dir, "product-release-receipt.json");
  writeFileSync(productDst, productContent);
  writeFileSync(resolve(dir, "product-release-receipt.sha256"), createHash("sha256").update(productContent).digest("hex"));

  return { runnerDst, productDst };
}

// ---------------------------------------------------------------------------
// Positive control (point: "정상 baseline은 unexplained 0을 출력").
// ---------------------------------------------------------------------------

test("positive control: the committed inventory is drift-free against a live re-scan", () => {
  const result = validateInventory();
  assert.deepEqual(result.errors, []);
  assert.equal(result.derivedUsedCount, result.committedUsedCount);
  assert.ok(result.committedCandidateCount > 0);
});

test("positive control: the real U007 receipt pair satisfies the pre_u030 prerequisite", () => {
  const prereq = validateReleasePrerequisite(REAL_ENV);
  assert.equal(prereq.runner_contract_status, "PASS");
  assert.equal(prereq.product_release_status, "RED_EXPECTED");
  assert.match(prereq.candidateSha, /^[0-9a-f]{40}$/);
  assert.match(prereq.runnerContractReceiptSha256, /^[0-9a-f]{64}$/);
  assert.match(prereq.productReleaseReceiptSha256, /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// Failing-first: new entrypoint not in inventory.
// ---------------------------------------------------------------------------

test("a new real Next.js route not present in the committed inventory is reported as drift", () => {
  return withTmpDir("u008-red-route-", (fixtureRoot) => {
    cpSync(repoRoot, fixtureRoot, {
      recursive: true,
      filter: (src) => !src.includes("/node_modules/") && !src.includes("/.git/") && !src.includes("/.next/"),
    });
    const routeDir = resolve(fixtureRoot, "apps/web/src/app/(portal)/u008-fixture-new-route");
    mkdirSync(routeDir, { recursive: true });
    writeFileSync(resolve(routeDir, "page.tsx"), "export default function Page(){return null;}\n");

    const result = validateInventory(fixtureRoot, resolve(fixtureRoot, "docs/12_VERIFICATION/entrypoint-inventory.json"));
    assert.ok(result.errors.some((e) => e.includes("u008-fixture-new-route")));
  });
});

test("deleting a real committed entrypoint file from disk (inventory unchanged) is reported as drift", () => {
  return withTmpDir("u008-red-deleted-", (fixtureRoot) => {
    cpSync(repoRoot, fixtureRoot, {
      recursive: true,
      filter: (src) => !src.includes("/node_modules/") && !src.includes("/.git/") && !src.includes("/.next/"),
    });
    rmSync(resolve(fixtureRoot, "apps/web/src/app/api/health/route.ts"));

    const result = validateInventory(fixtureRoot, resolve(fixtureRoot, "docs/12_VERIFICATION/entrypoint-inventory.json"));
    assert.ok(result.errors.some((e) => e.startsWith("committed used entrypoint no longer discoverable: root next-route apps/web/src/app/api/health/route.ts")));
  });
});

// ---------------------------------------------------------------------------
// Failing-first: Next route / MCP tool / manual script wrongly classified as
// unused (removed from the committed inventory while still real on disk).
// ---------------------------------------------------------------------------

test("dropping a real Next.js route from the inventory is caught as a removed-entrypoint drift", () => {
  return withMutatedInventory(
    (inv) => {
      inv.entries = inv.entries.filter((e) => !(e.workspace === "root" && e.entryType === "next-route" && e.path === "apps/web/src/app/api/health/route.ts"));
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("apps/web/src/app/api/health/route.ts")));
    },
  );
});

test("dropping a real engineer MCP tool from the inventory is caught as a removed-entrypoint drift", () => {
  return withMutatedInventory(
    (inv) => {
      inv.entries = inv.entries.filter((e) => !(e.workspace === "engineer" && e.entryType === "mcp-tool" && e.name === "sangfor.products"));
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("sangfor.products")));
    },
  );
});

test("dropping real manual CLI scripts from the inventory is caught as drift (files still exist on disk)", () => {
  return withMutatedInventory(
    (inv) => {
      inv.entries = inv.entries.filter((e) => !(e.workspace === "engineer" && e.entryType === "cli-script" && e.usage.manual === true));
      return inv;
    },
    (result) => {
      // The files are still real on disk, so the live re-scan still finds them; the
      // committed (mutated) inventory is what's missing them, hence "added by tree".
      const hit = result.errors.some((e) => e.startsWith("new real entrypoint not in committed inventory: engineer cli-script"));
      assert.equal(hit, true);
      assert.ok(result.errors.length >= 20);
    },
  );
});

// ---------------------------------------------------------------------------
// Failing-first: allowlist exception missing owner/reason/expiry, or expired.
// ---------------------------------------------------------------------------

test("a candidate_for_U030 exception with a blank owner fails validation", () => {
  return withMutatedInventory(
    (inv) => {
      const target = inv.entries.find((e) => e.disposition === "candidate_for_U030");
      target.owner = "";
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("missing owner")));
    },
  );
});

test("a candidate_for_U030 exception with a missing reason fails validation", () => {
  return withMutatedInventory(
    (inv) => {
      const target = inv.entries.find((e) => e.disposition === "candidate_for_U030");
      target.reason = "";
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("weak concrete reason")));
    },
  );
});

test("a candidate_for_U030 exception with a missing expiry fails validation", () => {
  return withMutatedInventory(
    (inv) => {
      const target = inv.entries.find((e) => e.disposition === "candidate_for_U030");
      target.expiry = null;
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("missing expiry/review-unit")));
    },
  );
});

test("a candidate_for_U030 exception with an expired ISO date fails validation", () => {
  return withMutatedInventory(
    (inv) => {
      const target = inv.entries.find((e) => e.disposition === "candidate_for_U030");
      target.expiry = "2020-01-01";
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("expired")));
    },
  );
});

// ---------------------------------------------------------------------------
// Failing-first: stale allowlist path (file no longer exists).
// ---------------------------------------------------------------------------

test("a candidate_for_U030 file path that no longer exists on disk is a stale-exception failure", () => {
  return withMutatedInventory(
    (inv) => {
      const target = inv.entries.find((e) => e.disposition === "candidate_for_U030" && e.entryType === "unused-file");
      target.path = "apps/web/src/does-not-exist-anymore.tsx";
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("stale allowlist path")));
    },
  );
});

// ---------------------------------------------------------------------------
// Failing-first: same path ambiguously owned by two workspaces.
// ---------------------------------------------------------------------------

test("the same physical file claimed by two workspaces is reported as ambiguous ownership", () => {
  return withMutatedInventory(
    (inv) => {
      inv.entries.push({
        workspace: "root",
        entryType: "app-entry",
        path: "services/sangfor-engineer-mcp/apps/mcp-server/src/index.ts",
        name: null,
        discoverySource: "fixture-injected duplicate claim",
        usage: { runtime: true, build: false, test: false, manual: false },
        owner: "root-workspace-maintainers",
        disposition: "used",
        reason: "Fixture: root inventory wrongly re-claims a file engineer already owns.",
        expiry: null,
      });
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("ambiguous cross-workspace ownership")));
    },
  );
});

// ---------------------------------------------------------------------------
// Failing-first: knip.json exceptions with no matching inventory record, or
// wildcard-only hiding.
// ---------------------------------------------------------------------------

test("removing a candidate's inventory record while knip.json still ignores it fails cross-reference", () => {
  return withMutatedInventory(
    (inv) => {
      inv.entries = inv.entries.filter((e) => !(e.disposition === "candidate_for_U030" && e.entryType === "unused-dependency" && e.name === "postcss"));
      return inv;
    },
    (result) => {
      assert.ok(result.errors.some((e) => e.includes("knip.json") && e.includes("postcss")));
    },
  );
});

// ---------------------------------------------------------------------------
// Failing-first: U007 receipt problems must gate with exit 64 before Knip.
// ---------------------------------------------------------------------------

test("missing U007 env vars raises a 64-exit-code error", () => {
  assert.throws(
    () => validateReleasePrerequisite({}),
    (error) => error.code === "RELEASE_PREREQ_ENV_MISSING" && error.exitCode === 64,
  );
});

test("a relative receipt path raises a 64-exit-code error", () => {
  assert.throws(
    () => validateReleasePrerequisite({
      U007_RUNNER_CONTRACT_RECEIPT_FILE: "relative/runner.json",
      U007_PRODUCT_RELEASE_RECEIPT_FILE: REAL_ENV.U007_PRODUCT_RELEASE_RECEIPT_FILE,
    }),
    (error) => error.code === "RELEASE_PREREQ_PATH_RELATIVE" && error.exitCode === 64,
  );
});

test("a path-escaping receipt path raises a 64-exit-code error", () => {
  assert.throws(
    () => validateReleasePrerequisite({
      U007_RUNNER_CONTRACT_RECEIPT_FILE: `${U007_DIR}/../../../etc/runner.json`,
      U007_PRODUCT_RELEASE_RECEIPT_FILE: REAL_ENV.U007_PRODUCT_RELEASE_RECEIPT_FILE,
    }),
    (error) => error.code === "RELEASE_PREREQ_PATH_ESCAPE" && error.exitCode === 64,
  );
});

test("a symlinked receipt file raises a 64-exit-code error", () => {
  return withTmpDir("u008-red-symlink-", (dir) => {
    symlinkSync(REAL_ENV.U007_RUNNER_CONTRACT_RECEIPT_FILE, resolve(dir, "runner-contract-receipt.json"));
    writeFileSync(resolve(dir, "runner-contract-receipt.sha256"), readFileSync(`${REAL_ENV.U007_RUNNER_CONTRACT_RECEIPT_FILE.replace(/\.json$/, ".sha256")}`));
    const { productDst } = copyU007Fixture(dir, undefined, { skipRunner: true });
    assert.throws(
      () => validateReleasePrerequisite({
        U007_RUNNER_CONTRACT_RECEIPT_FILE: resolve(dir, "runner-contract-receipt.json"),
        U007_PRODUCT_RELEASE_RECEIPT_FILE: productDst,
      }),
      (error) => error.code === "RELEASE_PREREQ_SYMLINK" && error.exitCode === 64,
    );
  });
});

test("a product receipt forged to PASS instead of RED_EXPECTED raises a 64-exit-code error", () => {
  return withTmpDir("u008-red-forged-pass-", (dir) => {
    const { runnerDst, productDst } = copyU007Fixture(dir, (product) => { product.product_release_status = "PASS"; });
    assert.throws(
      () => validateReleasePrerequisite({
        U007_RUNNER_CONTRACT_RECEIPT_FILE: runnerDst,
        U007_PRODUCT_RELEASE_RECEIPT_FILE: productDst,
      }),
      (error) => error.code === "RELEASE_PREREQ_CHECKER_FAILED" && error.exitCode === 64,
    );
  });
});

test("a product receipt with a drifted (empty) blocker set raises a 64-exit-code error", () => {
  return withTmpDir("u008-red-blocker-drift-", (dir) => {
    const { runnerDst, productDst } = copyU007Fixture(dir, (product) => { product.preflightBlockers = []; });
    assert.throws(
      () => validateReleasePrerequisite({
        U007_RUNNER_CONTRACT_RECEIPT_FILE: runnerDst,
        U007_PRODUCT_RELEASE_RECEIPT_FILE: productDst,
      }),
      (error) => error.code === "RELEASE_PREREQ_CHECKER_FAILED" && error.exitCode === 64,
    );
  });
});

test("a product receipt whose blocker is not exactly @sangfor/ui raises a 64-exit-code error", () => {
  return withTmpDir("u008-red-blocker-mismatch-", (dir) => {
    const { runnerDst, productDst } = copyU007Fixture(dir, (product) => { product.preflightBlockers[0].package = "@sangfor/not-ui"; });
    assert.throws(
      () => validateReleasePrerequisite({
        U007_RUNNER_CONTRACT_RECEIPT_FILE: runnerDst,
        U007_PRODUCT_RELEASE_RECEIPT_FILE: productDst,
      }),
      (error) => error.code === "RELEASE_PREREQ_CHECKER_FAILED" && error.exitCode === 64,
    );
  });
});

test("a candidateSha that is not an ancestor of HEAD raises a 64-exit-code error", () => {
  return withTmpDir("u008-red-nonancestor-", (dir) => {
    const runner = JSON.parse(readFileSync(REAL_ENV.U007_RUNNER_CONTRACT_RECEIPT_FILE, "utf8"));
    runner.candidateSha = `${"0".repeat(39)}a`; // valid 40-hex format, not an ancestor of HEAD
    const runnerContent = Buffer.from(`${JSON.stringify(runner, null, 2)}\n`);
    const runnerDst = resolve(dir, "runner-contract-receipt.json");
    writeFileSync(runnerDst, runnerContent);
    writeFileSync(resolve(dir, "runner-contract-receipt.sha256"), createHash("sha256").update(runnerContent).digest("hex"));

    const { productDst } = copyU007Fixture(dir, (product) => {
      product.candidateSha = runner.candidateSha;
      product.runnerContractReceiptSha256 = createHash("sha256").update(runnerContent).digest("hex");
    }, { skipRunner: true });

    assert.throws(
      () => validateReleasePrerequisite({
        U007_RUNNER_CONTRACT_RECEIPT_FILE: runnerDst,
        U007_PRODUCT_RELEASE_RECEIPT_FILE: productDst,
      }),
      (error) => error.code === "RELEASE_PREREQ_CANDIDATE_NOT_ANCESTOR" && error.exitCode === 64,
    );
  });
});

test("a missing sidecar hash file raises a 64-exit-code error", () => {
  return withTmpDir("u008-red-missing-sidecar-", (dir) => {
    const runnerContent = readFileSync(REAL_ENV.U007_RUNNER_CONTRACT_RECEIPT_FILE);
    const runnerDst = resolve(dir, "runner-contract-receipt.json");
    writeFileSync(runnerDst, runnerContent);
    // Intentionally omit runner-contract-receipt.sha256.
    const { productDst } = copyU007Fixture(dir, undefined, { skipRunner: true });
    assert.throws(
      () => validateReleasePrerequisite({
        U007_RUNNER_CONTRACT_RECEIPT_FILE: runnerDst,
        U007_PRODUCT_RELEASE_RECEIPT_FILE: productDst,
      }),
      (error) => error.code === "RELEASE_PREREQ_MISSING" && error.exitCode === 64,
    );
  });
});

// ---------------------------------------------------------------------------
// Discovery function sanity (grounds the "re-scan current tree" contract).
// ---------------------------------------------------------------------------

test("discoverAllUsed only returns recognized entryTypes for each workspace", () => {
  const ROOT_TYPES = new Set([
    "next-page", "next-route", "package-export", "cli-script", "test-script",
    "sql-script", "prisma-schema", "prisma-seed", "prisma-migrations",
    "playwright-config", "vitest-config",
  ]);
  const ENGINEER_TYPES = new Set([
    "app-entry", "operator-route", "mcp-tool", "cli-script", "prisma-schema",
    "pptx-export", "vitest-config",
  ]);
  const WORKFLOW_TYPES = new Set([
    "app-entry", "operator-route", "bootstrap-script", "mcp-tool",
    "package-export", "cli-script", "vitest-config",
  ]);
  for (const entry of discoverAllUsed()) {
    if (entry.workspace === "root") assert.ok(ROOT_TYPES.has(entry.entryType), entry.entryType);
    else if (entry.workspace === "engineer") assert.ok(ENGINEER_TYPES.has(entry.entryType), entry.entryType);
    else if (entry.workspace === "workflow") assert.ok(WORKFLOW_TYPES.has(entry.entryType), entry.entryType);
    else assert.fail(`unknown workspace: ${entry.workspace}`);
  }
});

test("engineer MCP tool catalog discovery finds the real sangfor.products tool", () => {
  const tools = discoverEngineerMcpTools();
  assert.ok(tools.some((t) => t.name === "sangfor.products"));
  assert.ok(tools.length >= 40);
});

test("workflow MCP tool catalog discovery finds tools from all three tool files", () => {
  const tools = discoverWorkflowMcpTools();
  assert.ok(tools.some((t) => t.path.endsWith("workflow-tools.ts")));
  assert.ok(tools.some((t) => t.path.endsWith("integration-tools.ts")));
  assert.ok(tools.some((t) => t.path.endsWith("operation-tools.ts")));
});

// ---------------------------------------------------------------------------
// point 10 — cleanup contract and CLI evidence-dir writer.
// ---------------------------------------------------------------------------

test("running the CLI with --evidence-dir writes the exact point-10 cleanup=N/A object", async () => {
  await withTmpDir("u008-evidence-dir-", async (dir) => {
    const { execFileSync } = await import("node:child_process");
    const scriptPath = resolve(repoRoot, "scripts/check-entrypoint-inventory.mjs");
    const stdout = execFileSync(process.execPath, [scriptPath, "--evidence-dir", dir], {
      env: { ...process.env, ...REAL_ENV },
      encoding: "utf8",
    });
    const report = JSON.parse(stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);

    const cleanupOnDisk = JSON.parse(readFileSync(resolve(dir, "cleanup.json"), "utf8"));
    assert.deepEqual(cleanupOnDisk, {
      listeners: "N/A",
      ports: "N/A",
      temporaryDirectories: "N/A",
      containers: "N/A",
      images: "N/A",
      networks: "N/A",
      volumes: "N/A",
      databases: "N/A",
      reason: "U008 executes finite read-only inventory processes and creates no runtime resource",
      commandChildrenExited: true,
    });

    const inventoryCheckOnDisk = JSON.parse(readFileSync(resolve(dir, "inventory-check.json"), "utf8"));
    assert.deepEqual(inventoryCheckOnDisk, report);
  });
});

test("the CLI exits 64 before running any inventory validation when the release prerequisite fails", async () => {
  await withTmpDir("u008-cli-gate-", async (dir) => {
    const { spawnSync } = await import("node:child_process");
    const scriptPath = resolve(repoRoot, "scripts/check-entrypoint-inventory.mjs");
    const result = spawnSync(process.execPath, [scriptPath], {
      env: { ...process.env, U007_RUNNER_CONTRACT_RECEIPT_FILE: "", U007_PRODUCT_RELEASE_RECEIPT_FILE: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 64);
    assert.match(result.stderr, /RELEASE_PREREQ_ENV_MISSING/);
  });
});
