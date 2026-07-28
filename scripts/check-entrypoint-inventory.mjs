#!/usr/bin/env node
/**
 * U008 — entrypoint inventory + independent Knip-baseline validator.
 *
 * Responsibilities (dispatch points 1-10):
 *  1. Re-derive the "used" entrypoint surface for root/engineer/workflow directly
 *     from the current tree (never from .omo audit artifacts).
 *  2. Diff that derived surface against the committed
 *     docs/12_VERIFICATION/entrypoint-inventory.json (drift => failure).
 *  3. Cross-validate every knip.json ignore-type exception (ignore,
 *     ignoreDependencies, ignoreIssues, ignoreUnresolved) against the
 *     inventory's candidate_for_U030 records: owner + concrete reason +
 *     non-expired expiry/review-unit, no stale paths, no path-wildcard-only
 *     hiding, no ambiguous cross-workspace ownership.
 *  4. Gate everything behind the U007 dual-receipt pre_u030 prerequisite
 *     (point 8) BEFORE any of the above runs.
 *  5. Emit the exact point-10 cleanup=N/A object.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY_PATH = resolve(repoRoot, "docs/12_VERIFICATION/entrypoint-inventory.json");
const RELEASE_CHECKER = resolve(repoRoot, "scripts/check-release-state-receipts.mjs");
const REVIEW_UNIT = "U030";

class CheckError extends Error {
  constructor(code, message, exitCode) {
    super(`${code}: ${message}`);
    this.name = "CheckError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// point 8 — release prerequisite gate (reuse check-release-state-receipts.mjs
// as an external process; never edit that file).
// ---------------------------------------------------------------------------

function assertAbsoluteNoEscape(label, raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new CheckError("RELEASE_PREREQ_ENV_MISSING", `${label} is missing`, 64);
  }
  if (raw.includes("\0")) {
    throw new CheckError("RELEASE_PREREQ_PATH_ESCAPE", `${label} contains a NUL byte`, 64);
  }
  if (!raw.startsWith("/")) {
    throw new CheckError("RELEASE_PREREQ_PATH_RELATIVE", `${label} must be absolute: ${raw}`, 64);
  }
  if (raw.split("/").some((segment) => segment === "..")) {
    throw new CheckError("RELEASE_PREREQ_PATH_ESCAPE", `${label} must not contain '..': ${raw}`, 64);
  }
  return raw;
}

function assertRegularNonSymlink(label, path) {
  let st;
  try {
    st = lstatSync(path);
  } catch (error) {
    throw new CheckError(
      "RELEASE_PREREQ_MISSING",
      `${label} unreadable: ${path}: ${error instanceof Error ? error.message : String(error)}`,
      64,
    );
  }
  if (st.isSymbolicLink()) {
    throw new CheckError("RELEASE_PREREQ_SYMLINK", `${label} must not be a symlink: ${path}`, 64);
  }
  if (!st.isFile()) {
    throw new CheckError("RELEASE_PREREQ_MISSING", `${label} is not a regular file: ${path}`, 64);
  }
}

function sidecarPath(jsonPath) {
  return jsonPath.replace(/\.json$/, ".sha256");
}

function isAncestorOfHead(candidateSha, cwd) {
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    throw new CheckError("RELEASE_PREREQ_CANDIDATE_SHA_FORMAT", `bad candidateSha: ${candidateSha}`, 64);
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", candidateSha, "HEAD"], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the point-35 dual-receipt checker as an external process (reuse only;
 * this file never imports/mutates check-release-state-receipts.mjs) and adds
 * the symlink / path-escape / ancestor checks the dispatch requires on top.
 */
export function validateReleasePrerequisite(env = process.env) {
  const runnerPath = assertAbsoluteNoEscape(
    "U007_RUNNER_CONTRACT_RECEIPT_FILE",
    env.U007_RUNNER_CONTRACT_RECEIPT_FILE,
  );
  const productPath = assertAbsoluteNoEscape(
    "U007_PRODUCT_RELEASE_RECEIPT_FILE",
    env.U007_PRODUCT_RELEASE_RECEIPT_FILE,
  );

  for (const [label, path] of [
    ["runner receipt", runnerPath],
    ["runner sidecar", sidecarPath(runnerPath)],
    ["product receipt", productPath],
    ["product sidecar", sidecarPath(productPath)],
  ]) {
    assertRegularNonSymlink(label, path);
  }

  let spawnResult;
  try {
    spawnResult = execFileSync(
      process.execPath,
      [RELEASE_CHECKER, "--phase", "pre_u030", "--runner", runnerPath, "--product", productPath],
      { encoding: "utf8" },
    );
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : (error instanceof Error ? error.message : String(error));
    throw new CheckError("RELEASE_PREREQ_CHECKER_FAILED", `check-release-state-receipts.mjs rejected the pair: ${stderr}`, 64);
  }
  let parsed;
  try {
    parsed = JSON.parse(spawnResult);
  } catch (error) {
    throw new CheckError(
      "RELEASE_PREREQ_CHECKER_OUTPUT_INVALID",
      `checker stdout was not JSON: ${error instanceof Error ? error.message : String(error)}`,
      64,
    );
  }
  if (parsed.ok !== true || parsed.phase !== "pre_u030") {
    throw new CheckError("RELEASE_PREREQ_CHECKER_FAILED", `unexpected checker output: ${spawnResult}`, 64);
  }

  const runner = JSON.parse(readFileSync(runnerPath, "utf8"));
  const product = JSON.parse(readFileSync(productPath, "utf8"));
  if (runner.runner_contract_status !== "PASS") {
    throw new CheckError("RELEASE_PREREQ_RUNNER_NOT_PASS", "runner_contract_status must be PASS", 64);
  }
  if (product.product_release_status !== "RED_EXPECTED") {
    throw new CheckError("RELEASE_PREREQ_NOT_RED_EXPECTED", "product_release_status must be RED_EXPECTED", 64);
  }
  if (!Array.isArray(product.preflightBlockers) || product.preflightBlockers.length !== 1) {
    throw new CheckError("RELEASE_PREREQ_BLOCKER_COUNT", "expected exactly one preflight blocker", 64);
  }
  const blocker = product.preflightBlockers[0];
  if (blocker.package !== "@sangfor/ui") {
    throw new CheckError("RELEASE_PREREQ_BLOCKER_MISMATCH", `expected @sangfor/ui blocker, got ${blocker.package}`, 64);
  }
  if (!isAncestorOfHead(runner.candidateSha, repoRoot)) {
    throw new CheckError(
      "RELEASE_PREREQ_CANDIDATE_NOT_ANCESTOR",
      `candidateSha ${runner.candidateSha} is not an ancestor of HEAD`,
      64,
    );
  }

  return {
    runnerContractReceiptSha256: parsed.runnerHash,
    productReleaseReceiptSha256: parsed.productHash,
    candidateSha: runner.candidateSha,
    runner_contract_status: runner.runner_contract_status,
    product_release_status: product.product_release_status,
  };
}

// ---------------------------------------------------------------------------
// Filesystem discovery helpers (points 2-4, 7 — re-scan current tree).
// ---------------------------------------------------------------------------

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", ".git"]);

function walk(root, dir, predicate, out = []) {
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs).sort((a, b) => a.localeCompare(b, "en"))) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const relPath = dir === "." ? name : `${dir}/${name}`;
    const absChild = resolve(root, relPath);
    const st = statSync(absChild);
    if (st.isDirectory()) {
      walk(root, relPath, predicate, out);
    } else if (st.isFile() && predicate(relPath)) {
      out.push(relPath);
    }
  }
  return out;
}

function sortedEntries(entries) {
  return [...entries].sort((a, b) => {
    const wc = a.workspace.localeCompare(b.workspace, "en");
    if (wc !== 0) return wc;
    const pc = a.path.localeCompare(b.path, "en");
    if (pc !== 0) return pc;
    return (a.name ?? "").localeCompare(b.name ?? "", "en");
  });
}

function usedEntry({ workspace, entryType, path, name = null, discoverySource, usage, owner, reason }) {
  return {
    workspace,
    entryType,
    path,
    name,
    discoverySource,
    usage: { runtime: false, build: false, test: false, manual: false, ...usage },
    owner,
    disposition: "used",
    reason,
    expiry: null,
  };
}

function candidateEntry({ workspace, entryType, path, name = null, discoverySource, usage, owner, reason, expiry }) {
  return {
    workspace,
    entryType,
    path,
    name,
    discoverySource,
    usage: { runtime: false, build: false, test: false, manual: false, ...usage },
    owner,
    disposition: "candidate_for_U030",
    reason,
    expiry,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// --- root ---------------------------------------------------------------

const ROOT_OWNER = "root-workspace-maintainers";
const ROOT_SCRIPT_MANUAL_RE = /^(login|capture|crawl|interactive|extract|inspect|debug|probe|open|monitor)/i;

export function discoverRootUsed(root = repoRoot) {
  const entries = [];

  for (const path of walk(root, "apps/web/src/app", (p) => /\/(page|route)\.tsx?$/.test(`/${p}`))) {
    const entryType = path.endsWith(".ts") || /route\.tsx?$/.test(path) ? "next-route" : "next-page";
    entries.push(usedEntry({
      workspace: "root",
      entryType,
      path,
      discoverySource: "apps/web/src/app page.tsx|route.ts App Router glob",
      usage: { runtime: true, build: true },
      owner: ROOT_OWNER,
      reason: "Next.js App Router auto-wires this file as a page or route handler by filename convention.",
    }));
  }

  for (const pkgJsonRel of walk(root, "packages", (p) => p.endsWith("/package.json") && p.split("/").length === 3)) {
    const pkgDir = pkgJsonRel.slice(0, -"/package.json".length);
    const pkg = readJson(resolve(root, pkgJsonRel));
    const exportsField = pkg.exports && typeof pkg.exports === "object" ? pkg.exports : pkg.main ? { ".": pkg.main } : {};
    const seen = new Set();
    for (const [subpath, target] of Object.entries(exportsField)) {
      const targetPath = typeof target === "string" ? target : target?.import ?? target?.default ?? target?.types;
      if (typeof targetPath !== "string") continue;
      if (subpath.includes("*") || targetPath.includes("*")) continue; // wildcard export map pattern, not a single stable path
      const resolvedRel = `${pkgDir}/${targetPath.replace(/^\.\//, "")}`;
      if (seen.has(resolvedRel)) continue;
      seen.add(resolvedRel);
      entries.push(usedEntry({
        workspace: "root",
        entryType: "package-export",
        path: resolvedRel,
        name: `${pkg.name}${subpath === "." ? "" : subpath}`,
        discoverySource: `${pkgJsonRel} exports field`,
        usage: { runtime: true, build: true },
        owner: ROOT_OWNER,
        reason: `Declared package export of ${pkg.name}; consumed by workspace dependents via the exports map.`,
      }));
    }
  }

  for (const relPath of walk(root, "scripts", (p) => p.split("/").length === 2)) {
    const base = relPath.split("/").pop();
    if (/\.test\.mjs$/.test(base)) {
      entries.push(usedEntry({
        workspace: "root",
        entryType: "test-script",
        path: relPath,
        discoverySource: "scripts/*.test.mjs (node --test convention)",
        usage: { test: true },
        owner: ROOT_OWNER,
        reason: "node --test entry file exercised directly by its own filename, not imported.",
      }));
      continue;
    }
    if (/\.(sh|mjs|cjs|py|command)$/.test(base)) {
      entries.push(usedEntry({
        workspace: "root",
        entryType: "cli-script",
        path: relPath,
        discoverySource: "scripts/ directory CLI entrypoint",
        usage: { manual: ROOT_SCRIPT_MANUAL_RE.test(base), runtime: !ROOT_SCRIPT_MANUAL_RE.test(base) },
        owner: ROOT_OWNER,
        reason: "Directly-invoked CLI script (root package.json script or ops runbook entrypoint).",
      }));
      continue;
    }
    if (/\.sql$/.test(base)) {
      entries.push(usedEntry({
        workspace: "root",
        entryType: "sql-script",
        path: relPath,
        discoverySource: "scripts/ directory SQL tool",
        usage: { manual: true },
        owner: ROOT_OWNER,
        reason: "SQL script invoked by an operator or a wrapping shell script.",
      }));
    }
  }

  entries.push(usedEntry({
    workspace: "root",
    entryType: "prisma-schema",
    path: "packages/db/prisma/schema.prisma",
    discoverySource: "packages/db/prisma/schema.prisma",
    usage: { build: true, runtime: true },
    owner: ROOT_OWNER,
    reason: "Prisma schema; source of truth for db:generate/db:migrate/db:push.",
  }));
  entries.push(usedEntry({
    workspace: "root",
    entryType: "prisma-seed",
    path: "packages/db/prisma/seed.ts",
    discoverySource: "packages/db package.json db:seed script",
    usage: { manual: true },
    owner: ROOT_OWNER,
    reason: "Invoked by packages/db's db:seed script (tsx prisma/seed.ts).",
  }));
  if (existsSync(resolve(root, "packages/db/prisma/migrations"))) {
    entries.push(usedEntry({
      workspace: "root",
      entryType: "prisma-migrations",
      path: "packages/db/prisma/migrations",
      discoverySource: "packages/db/prisma/migrations directory",
      usage: { build: true },
      owner: ROOT_OWNER,
      reason: "Versioned migration history applied via prisma migrate deploy; aggregate directory entry.",
    }));
  }

  for (const path of ["playwright.config.ts", "playwright.acceptance.config.ts"]) {
    if (!existsSync(resolve(root, path))) continue;
    entries.push(usedEntry({
      workspace: "root",
      entryType: "playwright-config",
      path,
      discoverySource: "repo root Playwright config",
      usage: { test: true },
      owner: ROOT_OWNER,
      reason: "Playwright configuration referenced by test:e2e / test:acceptance scripts.",
    }));
  }
  for (const path of walk(root, "apps", (p) => /\/vitest\.config\.ts$/.test(`/${p}`))) {
    entries.push(usedEntry({
      workspace: "root",
      entryType: "vitest-config",
      path,
      discoverySource: "apps/*/vitest.config.ts",
      usage: { test: true },
      owner: ROOT_OWNER,
      reason: "Vitest configuration for this app's test script.",
    }));
  }
  for (const path of walk(root, "packages", (p) => /\/vitest\.config\.ts$/.test(`/${p}`))) {
    entries.push(usedEntry({
      workspace: "root",
      entryType: "vitest-config",
      path,
      discoverySource: "packages/*/vitest.config.ts",
      usage: { test: true },
      owner: ROOT_OWNER,
      reason: "Vitest configuration for this package's test script.",
    }));
  }

  return sortedEntries(entries);
}

// --- engineer -------------------------------------------------------------

const ENGINEER_OWNER = "engineer-workspace-maintainers";
const ENGINEER_MANUAL_RE = /^(login|capture|crawl|interactive|extract|inspect|debug|probe|resolve|open|test-)/i;

export function discoverEngineerMcpTools(root = repoRoot) {
  const indexPath = "apps/mcp-server/src/index.ts";
  const abs = resolve(root, "services/sangfor-engineer-mcp", indexPath);
  if (!existsSync(abs)) return [];
  const src = readFileSync(abs, "utf8");
  const names = [];
  for (const match of src.matchAll(/^ {2}'([a-zA-Z0-9_.]+)':\s*\{/gm)) names.push(match[1]);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "en")).map((name) => ({ name, path: indexPath }));
}

export function discoverEngineerUsed(root = repoRoot) {
  const wsRoot = "services/sangfor-engineer-mcp";
  const entries = [];

  for (const [dir, file] of [
    ["apps/mcp-server", "src/index.ts"],
    ["apps/http-bridge", "src/server.ts"],
    ["apps/mock-sangfor-console", "src/server.ts"],
    ["apps/operator-console", "src/server.ts"],
  ]) {
    const rel = `${dir}/${file}`;
    if (!existsSync(resolve(root, wsRoot, rel))) continue;
    entries.push(usedEntry({
      workspace: "engineer",
      entryType: "app-entry",
      path: rel,
      discoverySource: `${wsRoot} package.json dev:* scripts`,
      usage: { runtime: true },
      owner: ENGINEER_OWNER,
      reason: `Process entrypoint launched by a package.json dev:* script (${dir}).`,
    }));
  }

  for (const rel of ["src/api.ts", "src/ui.ts"]) {
    const path = `apps/operator-console/${rel}`;
    if (!existsSync(resolve(root, wsRoot, path))) continue;
    entries.push(usedEntry({
      workspace: "engineer",
      entryType: "operator-route",
      path,
      discoverySource: "apps/operator-console/src operator route module",
      usage: { runtime: true },
      owner: ENGINEER_OWNER,
      reason: "Operator console route/UI module imported by apps/operator-console/src/server.ts.",
    }));
  }

  for (const tool of discoverEngineerMcpTools(root)) {
    entries.push(usedEntry({
      workspace: "engineer",
      entryType: "mcp-tool",
      path: tool.path,
      name: tool.name,
      discoverySource: "apps/mcp-server/src/index.ts tools catalog registration",
      usage: { runtime: true },
      owner: ENGINEER_OWNER,
      reason: "Registered in the MCP tools/list catalog and dispatched by tools/call.",
    }));
  }

  for (const relPath of walk(resolve(root, wsRoot), "scripts", (p) => p.split("/").length === 2 && /\.(ts|mjs|cjs)$/.test(p))) {
    const base = relPath.split("/").pop();
    entries.push(usedEntry({
      workspace: "engineer",
      entryType: "cli-script",
      path: relPath,
      discoverySource: `${wsRoot}/scripts directory CLI entrypoint`,
      usage: { manual: ENGINEER_MANUAL_RE.test(base), runtime: !ENGINEER_MANUAL_RE.test(base) },
      owner: ENGINEER_OWNER,
      reason: "Directly-invoked tsx/node CLI script (package.json script or documented manual runbook step).",
    }));
  }

  if (existsSync(resolve(root, wsRoot, "prisma/schema.prisma"))) {
    entries.push(usedEntry({
      workspace: "engineer",
      entryType: "prisma-schema",
      path: "prisma/schema.prisma",
      discoverySource: "services/sangfor-engineer-mcp/prisma/schema.prisma",
      usage: { build: true, runtime: true },
      owner: ENGINEER_OWNER,
      reason: "Prisma schema; source of truth for db:generate/db:migrate/db:push.",
    }));
  }

  if (existsSync(resolve(root, wsRoot, "packages/sangfor-pptx/src/index.ts"))) {
    entries.push(usedEntry({
      workspace: "engineer",
      entryType: "pptx-export",
      path: "packages/sangfor-pptx/src/index.ts",
      name: "@sangfor/pptx",
      discoverySource: "packages/sangfor-pptx package export, imported by generate_setting_guide_pptx tool handlers",
      usage: { runtime: true },
      owner: ENGINEER_OWNER,
      reason: "PPTX/DOCX generation package consumed by the sangfor.generate_*_pptx / *_docx MCP tools.",
    }));
  }

  if (existsSync(resolve(root, wsRoot, "vitest.config.ts"))) {
    entries.push(usedEntry({
      workspace: "engineer",
      entryType: "vitest-config",
      path: "vitest.config.ts",
      discoverySource: "services/sangfor-engineer-mcp/vitest.config.ts",
      usage: { test: true },
      owner: ENGINEER_OWNER,
      reason: "Vitest configuration for the engineer workspace test script.",
    }));
  }

  return sortedEntries(entries);
}

// --- workflow ---------------------------------------------------------------

const WORKFLOW_OWNER = "workflow-workspace-maintainers";

export function discoverWorkflowMcpTools(root = repoRoot) {
  const wsRoot = "services/sangfor-mcp-workflow";
  const toolsDir = "apps/mcp-server/src/tools";
  const out = [];
  for (const file of ["integration-tools.ts", "operation-tools.ts", "workflow-tools.ts"]) {
    const abs = resolve(root, wsRoot, toolsDir, file);
    if (!existsSync(abs)) continue;
    const src = readFileSync(abs, "utf8");
    for (const match of src.matchAll(/^ {4}([a-zA-Z0-9_]+):\s*\{/gm)) {
      out.push({ name: match[1], path: `${toolsDir}/${file}` });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function discoverWorkflowUsed(root = repoRoot) {
  const wsRoot = "services/sangfor-mcp-workflow";
  const entries = [];

  for (const [path, discoverySource] of [
    ["apps/mcp-server/src/index.ts", "package.json dev:mcp script"],
    ["apps/operator-console/src/server.ts", "package.json dev:web script"],
  ]) {
    if (!existsSync(resolve(root, wsRoot, path))) continue;
    entries.push(usedEntry({
      workspace: "workflow",
      entryType: "app-entry",
      path,
      discoverySource,
      usage: { runtime: true },
      owner: WORKFLOW_OWNER,
      reason: `Process entrypoint launched by ${discoverySource}.`,
    }));
  }

  for (const relPath of walk(resolve(root, wsRoot), "apps/operator-console/src/routes", () => true)) {
    entries.push(usedEntry({
      workspace: "workflow",
      entryType: "operator-route",
      path: relPath,
      discoverySource: "apps/operator-console/src/routes directory, wired via routes/index.ts",
      usage: { runtime: true },
      owner: WORKFLOW_OWNER,
      reason: "Operator console Express route module registered from routes/index.ts.",
    }));
  }

  for (const relPath of walk(resolve(root, wsRoot), "apps/operator-console/src/bootstrap", () => true)) {
    entries.push(usedEntry({
      workspace: "workflow",
      entryType: "bootstrap-script",
      path: relPath,
      discoverySource: "apps/operator-console/src/bootstrap directory",
      usage: { runtime: true },
      owner: WORKFLOW_OWNER,
      reason: "Operator console bootstrap module imported during server startup.",
    }));
  }

  for (const tool of discoverWorkflowMcpTools(root)) {
    entries.push(usedEntry({
      workspace: "workflow",
      entryType: "mcp-tool",
      path: tool.path,
      name: tool.name,
      discoverySource: "apps/mcp-server/src/tools/*.ts createXTools() catalog",
      usage: { runtime: true },
      owner: WORKFLOW_OWNER,
      reason: "Registered in the MCP tool catalog assembled by tool-catalog.ts.",
    }));
  }

  for (const pkgJsonRel of walk(resolve(root, wsRoot), "packages", (p) => p.endsWith("/package.json") && p.split("/").length === 3)) {
    const pkgDir = pkgJsonRel.slice(0, -"/package.json".length);
    const pkg = readJson(resolve(root, wsRoot, pkgJsonRel));
    const exportsField = pkg.exports && typeof pkg.exports === "object" ? pkg.exports : pkg.main ? { ".": pkg.main } : {};
    const seen = new Set();
    for (const [subpath, target] of Object.entries(exportsField)) {
      const targetPath = typeof target === "string" ? target : target?.import ?? target?.default ?? target?.types;
      if (typeof targetPath !== "string") continue;
      if (subpath.includes("*") || targetPath.includes("*")) continue; // wildcard export map pattern, not a single stable path
      const resolvedRel = `${pkgDir}/${targetPath.replace(/^\.\//, "")}`;
      if (seen.has(resolvedRel)) continue;
      seen.add(resolvedRel);
      entries.push(usedEntry({
        workspace: "workflow",
        entryType: "package-export",
        path: resolvedRel,
        name: `${pkg.name}${subpath === "." ? "" : subpath}`,
        discoverySource: `${pkgJsonRel} exports field`,
        usage: { runtime: true, build: true },
        owner: WORKFLOW_OWNER,
        reason: `Declared package export of ${pkg.name}; consumed by workspace dependents via the exports map.`,
      }));
    }
  }

  for (const relPath of walk(resolve(root, wsRoot), "scripts", (p) => p.split("/").length === 2 && /\.(ts|mjs|cjs)$/.test(p))) {
    const base = relPath.split("/").pop();
    entries.push(usedEntry({
      workspace: "workflow",
      entryType: "cli-script",
      path: relPath,
      discoverySource: `${wsRoot}/scripts directory CLI entrypoint`,
      usage: { manual: /^(run-|generate-|audit-)/.test(base), runtime: true },
      owner: WORKFLOW_OWNER,
      reason: "Directly-invoked tsx/node CLI script wired from package.json scripts.",
    }));
  }

  if (existsSync(resolve(root, wsRoot, "vitest.config.ts"))) {
    entries.push(usedEntry({
      workspace: "workflow",
      entryType: "vitest-config",
      path: "vitest.config.ts",
      discoverySource: "services/sangfor-mcp-workflow/vitest.config.ts",
      usage: { test: true },
      owner: WORKFLOW_OWNER,
      reason: "Vitest configuration for the workflow workspace test script.",
    }));
  }

  return sortedEntries(entries);
}

export function discoverAllUsed(root = repoRoot) {
  return sortedEntries([
    ...discoverRootUsed(root),
    ...discoverEngineerUsed(root),
    ...discoverWorkflowUsed(root),
  ]);
}

// ---------------------------------------------------------------------------
// Inventory structural validation (points 5, 6; failing-first list).
// ---------------------------------------------------------------------------

function isExpired(expiry, now = new Date()) {
  if (expiry === REVIEW_UNIT) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return new Date(`${expiry}T00:00:00Z`).getTime() < now.getTime();
  return "invalid-format";
}

function workspaceDirFor(workspace) {
  if (workspace === "root") return repoRoot;
  if (workspace === "engineer") return resolve(repoRoot, "services/sangfor-engineer-mcp");
  if (workspace === "workflow") return resolve(repoRoot, "services/sangfor-mcp-workflow");
  return null;
}

function loadKnipConfig(workspace) {
  const dir = workspaceDirFor(workspace);
  const path = resolve(dir, "knip.json");
  if (!existsSync(path)) throw new CheckError("KNIP_CONFIG_MISSING", `missing ${path}`, 65);
  return readJson(path);
}

/**
 * Validates the committed inventory against: (a) a freshly re-derived "used"
 * surface, (b) each workspace's knip.json ignore-type configuration, (c) the
 * failing-first invariants (owner/reason/expiry, staleness, ambiguous
 * ownership, wildcard-only hiding).
 */
export function validateInventory(root = repoRoot, inventoryPath = INVENTORY_PATH) {
  const errors = [];
  if (!existsSync(inventoryPath)) {
    throw new CheckError("INVENTORY_MISSING", `missing ${inventoryPath}`, 65);
  }
  const inventory = readJson(inventoryPath);
  if (!Array.isArray(inventory.entries)) errors.push("inventory.entries must be an array");

  const derivedUsed = discoverAllUsed(root);
  const committedUsed = (inventory.entries ?? []).filter((e) => e.disposition === "used");
  const committedCandidates = (inventory.entries ?? []).filter((e) => e.disposition === "candidate_for_U030");

  const keyOf = (e) => `${e.workspace} ${e.entryType} ${e.path} ${e.name ?? ""}`;
  const derivedKeys = new Set(derivedUsed.map(keyOf));
  const committedKeys = new Set(committedUsed.map(keyOf));
  const addedByTree = derivedUsed.filter((e) => !committedKeys.has(keyOf(e)));
  const removedFromTree = committedUsed.filter((e) => !derivedKeys.has(keyOf(e)));
  for (const e of addedByTree) errors.push(`new real entrypoint not in committed inventory: ${keyOf(e)}`);
  for (const e of removedFromTree) errors.push(`committed used entrypoint no longer discoverable: ${keyOf(e)}`);

  // Every entry: required fields, valid disposition, owner/reason present.
  for (const entry of inventory.entries ?? []) {
    for (const field of ["workspace", "entryType", "path", "discoverySource", "usage", "owner", "disposition", "reason"]) {
      if (entry[field] === undefined) errors.push(`entry missing field '${field}': ${JSON.stringify(entry)}`);
    }
    if (!["used", "candidate_for_U030"].includes(entry.disposition)) {
      errors.push(`invalid disposition: ${JSON.stringify(entry)}`);
    }
    if (!entry.owner || typeof entry.owner !== "string") errors.push(`missing owner: ${keyOf(entry)}`);
    if (!entry.reason || typeof entry.reason !== "string" || entry.reason.length < 10) {
      errors.push(`missing/weak concrete reason: ${keyOf(entry)}`);
    }
    if (entry.disposition === "candidate_for_U030") {
      if (!entry.expiry) {
        errors.push(`candidate missing expiry/review-unit: ${keyOf(entry)}`);
      } else {
        const expired = isExpired(entry.expiry);
        if (expired === "invalid-format") errors.push(`candidate expiry has invalid format: ${keyOf(entry)}`);
        else if (expired) errors.push(`candidate exception has expired: ${keyOf(entry)}`);
      }
    }
  }

  // Stale allowlist paths: every candidate file/script path must still exist.
  const NON_FILE_TYPES = new Set(["unused-dependency", "unlisted-dependency", "unresolved-import"]);
  for (const entry of committedCandidates) {
    if (NON_FILE_TYPES.has(entry.entryType)) continue;
    const dir = workspaceDirFor(entry.workspace);
    if (!dir || !existsSync(resolve(dir, entry.path))) {
      errors.push(`stale allowlist path (no longer exists): ${keyOf(entry)}`);
    }
  }

  // Ambiguous cross-workspace ownership: same repo-root-relative path claimed
  // by more than one workspace.
  const absPathOwners = new Map();
  for (const entry of inventory.entries ?? []) {
    const dir = workspaceDirFor(entry.workspace);
    if (!dir) continue;
    const abs = resolve(dir, entry.path);
    const owners = absPathOwners.get(abs) ?? new Set();
    owners.add(entry.workspace);
    absPathOwners.set(abs, owners);
  }
  for (const [abs, owners] of absPathOwners) {
    if (owners.size > 1) errors.push(`ambiguous cross-workspace ownership for ${abs}: ${[...owners].join(",")}`);
  }

  // Cross-reference every knip.json exception against a candidate record with
  // an exact (non-wildcard) path/name match.
  for (const workspace of ["root", "engineer", "workflow"]) {
    const cfg = loadKnipConfig(workspace);
    const exceptionPaths = new Set([...(cfg.ignore ?? []), ...Object.keys(cfg.ignoreIssues ?? {})]);
    const exceptionDeps = new Set(cfg.ignoreDependencies ?? []);
    const exceptionUnresolved = new Set(cfg.ignoreUnresolved ?? []);
    for (const value of [...exceptionPaths, ...exceptionDeps, ...exceptionUnresolved]) {
      if (typeof value === "string" && /[*{}!]/.test(value)) {
        errors.push(`knip.json exception uses a wildcard pattern, not an exact path/name (${workspace}): ${value}`);
      }
    }
    const candidatesForWorkspace = committedCandidates.filter((e) => e.workspace === workspace);
    const candidatePaths = new Set(candidatesForWorkspace.map((e) => e.path));
    const candidateNames = new Set(candidatesForWorkspace.filter((e) => e.name).map((e) => e.name));
    for (const p of exceptionPaths) {
      if (!candidatePaths.has(p)) errors.push(`knip.json exception has no inventory record (${workspace}): ${p}`);
    }
    for (const d of [...exceptionDeps, ...exceptionUnresolved]) {
      if (!candidateNames.has(d) && !candidatePaths.has(d)) {
        errors.push(`knip.json dependency/unresolved exception has no inventory record (${workspace}): ${d}`);
      }
    }
  }

  return { errors, derivedUsedCount: derivedUsed.length, committedUsedCount: committedUsed.length, committedCandidateCount: committedCandidates.length };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--evidence-dir") out.evidenceDir = argv[++i];
  }
  return out;
}

function buildCleanup() {
  return {
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
  };
}

export function run(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const releasePrerequisite = validateReleasePrerequisite(env);
  const { errors, derivedUsedCount, committedUsedCount, committedCandidateCount } = validateInventory();
  const cleanup = buildCleanup();
  const report = {
    schemaVersion: 1,
    unit: "U008",
    ok: errors.length === 0,
    releasePrerequisite,
    inventory: { derivedUsedCount, committedUsedCount, committedCandidateCount },
    errors,
    cleanup,
  };

  if (args.evidenceDir) {
    if (!args.evidenceDir.startsWith("/") || !existsSync(args.evidenceDir)) {
      throw new CheckError("EVIDENCE_DIR_INVALID", `--evidence-dir must be an existing absolute path: ${args.evidenceDir}`, 64);
    }
    writeFileSync(resolve(args.evidenceDir, "inventory-check.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(resolve(args.evidenceDir, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const report = run();
    process.exit(report.ok ? 0 : 65);
  } catch (error) {
    if (error instanceof CheckError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(error.exitCode);
    }
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  }
}
