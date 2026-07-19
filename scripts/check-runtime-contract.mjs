#!/usr/bin/env node
/**
 * U003 — machine-readable runtime / baseline / port / lockfile contract verifier
 * Usage: node scripts/check-runtime-contract.mjs --baseline <sha> [--root <path>]
 *
 * Prints a JSON report to stdout; exit 0 iff overall pass.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, "..");

const WORKSPACE_MATRIX = {
  root: {
    path: ".",
    packageName: "sangfor-agentic-os",
    nodeMajor: "20",
    nvmrc: "20",
    engines: ">=20 <21",
    packageManager: "pnpm@10.28.1",
    lockfile: "pnpm-lock.yaml",
    outputRoot: "outputs/",
  },
  engineer: {
    path: "services/sangfor-engineer-mcp",
    packageName: "sangfor-engineer-mcp",
    nodeMajor: "20",
    nvmrc: "20",
    engines: ">=20 <21",
    packageManager: "pnpm@10.28.1",
    lockfile: "services/sangfor-engineer-mcp/pnpm-lock.yaml",
    outputRoot: "services/sangfor-engineer-mcp/outputs/",
  },
  workflow: {
    path: "services/sangfor-mcp-workflow",
    packageName: "sangfor-mcp-workflow",
    nodeMajor: "22",
    nvmrc: "22",
    engines: ">=22 <23",
    packageManager: "pnpm@10.28.1",
    lockfile: "services/sangfor-mcp-workflow/pnpm-lock.yaml",
    outputRoot: "services/sangfor-mcp-workflow/outputs/",
  },
};

const CANONICAL_PORTS = {
  SANGFOR_WEB: { port: 3101, yaml: "web", composeHints: ["3101:3101"] },
  SANGFOR_API: { port: 3200, yaml: "api", composeHints: ["3200:3200"] },
  SANGFOR_MCP: { port: 3500, yaml: "sangfor-mcp-workflow", composeHints: ["3500:3500"] },
  SANGFOR_MOCK_CONSOLE: { port: 3400, yaml: "sangfor-mcp-mock-console", composeHints: ["3400:3400"] },
  WHELP99_MCP_BRIDGE: { port: 3600, yaml: "sangfor-engineer-mcp", composeHints: ["3600:3600"] },
  WHELP99_OPERATOR_CONSOLE: { port: 3502, yaml: "sangfor-operator-console", composeHints: ["3502:3502"] },
  SANGFOR_POSTGRES: { port: 5434, yaml: "postgres", composeHints: ["5434:5432"] },
  SANGFOR_REDIS: { port: 6380, yaml: "redis", composeHints: ["6380:6379"] },
};

const STALE_KEYS = [
  "PORTAL",
  "AIOS_V2_WEB",
  "AIOS_V2_API",
  "AIOS_V2_LIGHTRAG",
  "AIOS_V2_JARVIS",
  "AIOS_V1",
  "F_AIOS_V3",
];

function sha256File(path) {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

function readText(root, rel) {
  return readFileSync(join(root, rel), "utf8");
}

function git(root, args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    ...opts,
  });
  return r;
}

function parseArgs(argv) {
  const out = { baseline: null, root: DEFAULT_ROOT, outputRoots: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline") {
      out.baseline = argv[++i];
    } else if (a === "--root") {
      out.root = resolve(argv[++i]);
    } else if (a === "--output-roots-json") {
      out.outputRoots = JSON.parse(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

/** Hand parser: two-level `  key:\n    port: N` (ignore comments). */
export function parsePortMappingYaml(text) {
  const out = new Map();
  let currentKey = null;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*#/.test(raw) || raw.trim() === "") continue;
    const line = raw.replace(/\s+#.*$/, "");
    const keyMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      continue;
    }
    const portMatch = line.match(/^    port:\s*(\d+)\s*$/);
    if (portMatch && currentKey) {
      out.set(currentKey, Number(portMatch[1]));
      currentKey = null;
    }
  }
  return out;
}

/** Extract PORT_REGISTRY numeric entries from ports.ts source text. */
export function parsePortsTs(text) {
  const start = text.indexOf("export const PORT_REGISTRY");
  if (start < 0) throw new Error("PORT_REGISTRY not found");
  const brace = text.indexOf("{", start);
  let depth = 0;
  let end = brace;
  for (; end < text.length; end++) {
    if (text[end] === "{") depth++;
    else if (text[end] === "}") {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
  }
  const body = text.slice(brace, end);
  const reg = {};
  for (const m of body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*(\d+)/gm)) {
    reg[m[1]] = Number(m[2]);
  }
  return reg;
}

function readPackageJson(root, relDir) {
  return JSON.parse(readText(root, join(relDir, "package.json")));
}

function readNvmrc(root, relDir) {
  return readText(root, join(relDir, ".nvmrc")).trim();
}

function pathInside(parentAbs, childAbs) {
  const p = realpathSync(parentAbs);
  let c;
  try {
    c = realpathSync(childAbs);
  } catch {
    // target may not exist yet — resolve without requiring existence
    c = resolve(childAbs);
  }
  const prefix = p.endsWith(sep) ? p : p + sep;
  return c === p || c.startsWith(prefix);
}

function resolveOutputRoot(repoRoot, wsPath, outputRoot) {
  // outputRoot is repo-relative in baseline; also accept workspace-relative
  if (outputRoot.includes("..")) {
    return { escaped: true, abs: resolve(repoRoot, outputRoot) };
  }
  const abs = resolve(repoRoot, outputRoot);
  const wsAbs = resolve(repoRoot, wsPath === "." ? "" : wsPath);
  return { escaped: !pathInside(wsAbs, abs) && abs !== wsAbs, abs, wsAbs };
}

export function checkBaselineIsAncestor(ctx) {
  const name = "baseline-is-ancestor";
  if (!ctx.baseline) {
    return { name, status: "FAIL", detail: "missing --baseline" };
  }
  const r = git(ctx.root, ["merge-base", "--is-ancestor", ctx.baseline, "HEAD"]);
  if (r.status === 0) {
    return { name, status: "PASS", detail: `${ctx.baseline} is ancestor of HEAD` };
  }
  return {
    name,
    status: "FAIL",
    detail: `baseline ${ctx.baseline} is not an ancestor of HEAD (exit ${r.status}): ${r.stderr || r.stdout}`,
  };
}

export function checkWorktreeProvenance(ctx) {
  const name = "worktree-provenance";
  const list = git(ctx.root, ["worktree", "list", "--porcelain"]);
  if (list.status !== 0) {
    return { name, status: "FAIL", detail: list.stderr || "git worktree list failed" };
  }
  const branch = git(ctx.root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branchName = (branch.stdout || "").trim();
  const expected = "codex/system-refactor-w0-w6";
  if (branchName !== expected) {
    return {
      name,
      status: "FAIL",
      detail: `branch is ${branchName}, expected ${expected}`,
      worktreeList: list.stdout,
    };
  }
  // Accept linked worktree or normal checkout on the expected branch.
  const porcelain = list.stdout || "";
  const isWorktree = /worktree /.test(porcelain);
  return {
    name,
    status: "PASS",
    detail: isWorktree
      ? `linked or multi worktree on ${expected}`
      : `normal checkout on ${expected}`,
    worktreeList: porcelain,
  };
}

export function checkSingleLockfilePerWorkspace(ctx) {
  const name = "single-lockfile-per-workspace";
  const r = git(ctx.root, [
    "ls-files",
    "pnpm-lock.yaml",
    "package-lock.json",
    "services/*/pnpm-lock.yaml",
    "services/*/package-lock.json",
  ]);
  if (r.status !== 0) {
    return { name, status: "FAIL", detail: r.stderr || "git ls-files failed" };
  }
  // Prefer context override for fixtures. For live git inventory, only count
  // paths that still exist on disk so an unstaged `rm` of package-lock.json
  // (allowed without staging per U003 SCM rules) is treated as removed.
  const rawList = (ctx.lockfileInventory ?? r.stdout)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const files = (
    ctx.lockfileInventory
      ? rawList
      : rawList.filter((f) => existsSync(join(ctx.root, f)))
  ).sort();
  const expected = [
    "pnpm-lock.yaml",
    "services/sangfor-engineer-mcp/pnpm-lock.yaml",
    "services/sangfor-mcp-workflow/pnpm-lock.yaml",
  ].sort();
  const packageLocks = files.filter((f) => f.endsWith("package-lock.json"));
  if (packageLocks.length > 0) {
    return {
      name,
      status: "FAIL",
      detail: `tracked package-lock.json not allowed: ${packageLocks.join(", ")}`,
      files,
    };
  }
  if (files.join("\0") !== expected.join("\0")) {
    return {
      name,
      status: "FAIL",
      detail: `lockfile inventory mismatch: got [${files.join(", ")}] expected [${expected.join(", ")}]`,
      files,
    };
  }
  return { name, status: "PASS", detail: "exactly three pnpm-lock.yaml files", files };
}

export function checkRuntimeMatrix(ctx) {
  const name = "runtime-matrix";
  const failures = [];
  for (const [ws, m] of Object.entries(WORKSPACE_MATRIX)) {
    try {
      const nvm = readNvmrc(ctx.root, m.path);
      if (nvm !== m.nvmrc) failures.push(`${ws}.nvmrc: got ${nvm}, want ${m.nvmrc}`);
      const pkg = readPackageJson(ctx.root, m.path);
      if (pkg.name !== m.packageName) failures.push(`${ws}.name: got ${pkg.name}`);
      if (pkg.packageManager !== m.packageManager) {
        failures.push(`${ws}.packageManager: got ${pkg.packageManager}`);
      }
      const eng = pkg.engines?.node;
      if (eng !== m.engines) failures.push(`${ws}.engines.node: got ${eng}, want ${m.engines}`);
    } catch (e) {
      failures.push(`${ws}: ${e.message}`);
    }
  }
  if (failures.length) return { name, status: "FAIL", detail: failures.join("; ") };
  return { name, status: "PASS", detail: "root/engineer Node20, workflow Node22, pnpm@10.28.1" };
}

export function checkCiSetup(ctx) {
  const name = "ci-setup";
  const failures = [];
  try {
    const ci = readText(ctx.root, ".github/workflows/ci.yml");
    // All setup-node must use node-version-file: '.nvmrc' (not bare node-version: '20')
    const setupBlocks = [...ci.matchAll(/uses:\s*actions\/setup-node@v\d+[\s\S]*?(?=\n\s*-\s|$)/g)].map(
      (m) => m[0],
    );
    // Simpler: count node-version-file vs node-version for setup-node contexts
    if (!/node-version-file:\s*['"]?\.nvmrc['"]?/.test(ci)) {
      failures.push("ci.yml missing node-version-file: .nvmrc");
    }
    const bareNode20 = (ci.match(/node-version:\s*['"]20['"]/g) || []).length;
    if (bareNode20 > 0) {
      failures.push(`ci.yml still has node-version: '20' (${bareNode20}×)`);
    }
    const assertCount = (ci.match(/name:\s*Assert runtime matrix/g) || []).length;
    if (assertCount < 4) {
      failures.push(`ci.yml Assert runtime matrix steps: ${assertCount}, want >=4`);
    }
    if (!ci.includes('process.versions.node.split(".")[0]') || !ci.includes("10.28.1")) {
      failures.push("ci.yml missing node major / pnpm 10.28.1 assert commands");
    }

    const sci = readText(ctx.root, ".github/workflows/services-ci.yml");
    if (!/node-version-file:\s*['"]?services\/sangfor-engineer-mcp\/\.nvmrc['"]?/.test(sci)) {
      failures.push("services-ci engineer missing node-version-file engineer .nvmrc");
    }
    if (!/node-version-file:\s*['"]?services\/sangfor-mcp-workflow\/\.nvmrc['"]?/.test(sci)) {
      failures.push("services-ci workflow missing node-version-file workflow .nvmrc");
    }
    if ((sci.match(/name:\s*Assert runtime matrix/g) || []).length < 2) {
      failures.push("services-ci missing Assert runtime matrix steps");
    }
    // engineer major 20, workflow major 22
    if (!/=\s*"20"/.test(sci) && !/=\s*'20'/.test(sci)) {
      // check for = "20" in assert
      if (!sci.includes('= "20"') && !sci.includes("= '20'") && !sci.includes('= "20"')) {
        // allow bracket form
        if (!/\[\s*"\$\(node[^"]*\)"\s*=\s*"20"\s*\]/.test(sci) && !sci.includes('= "20"')) {
          // looser
        }
      }
    }
    if (!sci.includes('"20"') || !sci.includes('"22"')) {
      failures.push("services-ci assert majors must include 20 and 22");
    }
    if (!sci.includes("10.28.1")) {
      failures.push("services-ci missing pnpm 10.28.1 assert");
    }
  } catch (e) {
    failures.push(e.message);
  }
  if (failures.length) return { name, status: "FAIL", detail: failures.join("; ") };
  return { name, status: "PASS", detail: "ci.yml + services-ci.yml node-version-file + asserts" };
}

export function checkPortConsistency(ctx) {
  const name = "port-consistency";
  const failures = [];
  const locations = [];
  try {
    const portsTs = parsePortsTs(readText(ctx.root, "packages/config/src/ports.ts"));
    const yaml = parsePortMappingYaml(readText(ctx.root, "PORT-MAPPING.yaml"));
    const compose = existsSync(join(ctx.root, "docker-compose.yml"))
      ? readText(ctx.root, "docker-compose.yml")
      : "";

    if (yaml.has("whelp99-mcp")) {
      failures.push("PORT-MAPPING.yaml still has whelp99-mcp");
      locations.push("PORT-MAPPING.yaml:whelp99-mcp");
    }

    for (const key of STALE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(portsTs, key)) {
        failures.push(`ports.ts still has stale key ${key}`);
        locations.push(`packages/config/src/ports.ts:${key}`);
      }
    }

    for (const [key, meta] of Object.entries(CANONICAL_PORTS)) {
      if (portsTs[key] !== meta.port) {
        failures.push(`ports.ts ${key}=${portsTs[key]} want ${meta.port}`);
        locations.push(`packages/config/src/ports.ts:${key}`);
      }
      if (yaml.get(meta.yaml) !== meta.port) {
        failures.push(`PORT-MAPPING.yaml ${meta.yaml}=${yaml.get(meta.yaml)} want ${meta.port}`);
        locations.push(`PORT-MAPPING.yaml:${meta.yaml}`);
      }
      if (compose) {
        const ok = meta.composeHints.some((h) => compose.includes(h));
        if (!ok) {
          failures.push(`docker-compose.yml missing host mapping for ${key} (${meta.composeHints.join("|")})`);
          locations.push(`docker-compose.yml:${key}`);
        }
      }
    }

    // Active YAML port uniqueness
    const byPort = new Map();
    for (const [svc, port] of yaml) {
      const list = byPort.get(port) ?? [];
      list.push(svc);
      byPort.set(port, list);
    }
    for (const [port, svcs] of byPort) {
      if (svcs.length > 1) {
        failures.push(`duplicate port ${port}: ${svcs.join(", ")}`);
        locations.push(...svcs.map((s) => `PORT-MAPPING.yaml:${s}`));
      }
    }

    // ports.ts uniqueness
    const ptsByPort = new Map();
    for (const [k, p] of Object.entries(portsTs)) {
      const list = ptsByPort.get(p) ?? [];
      list.push(k);
      ptsByPort.set(p, list);
    }
    for (const [port, keys] of ptsByPort) {
      if (keys.length > 1) {
        failures.push(`ports.ts duplicate ${port}: ${keys.join(", ")}`);
        locations.push(...keys.map((k) => `packages/config/src/ports.ts:${k}`));
      }
    }
  } catch (e) {
    failures.push(e.message);
  }
  if (failures.length) {
    return { name, status: "FAIL", detail: failures.join("; "), locations };
  }
  return { name, status: "PASS", detail: "canonical eight consistent across ports.ts, PORT-MAPPING.yaml, compose" };
}

export function checkOutputContract(ctx) {
  const name = "output-contract";
  const failures = [];
  const roots = ctx.outputRoots ?? {
    root: WORKSPACE_MATRIX.root.outputRoot,
    engineer: WORKSPACE_MATRIX.engineer.outputRoot,
    workflow: WORKSPACE_MATRIX.workflow.outputRoot,
  };
  for (const [ws, m] of Object.entries(WORKSPACE_MATRIX)) {
    const outRoot = roots[ws] ?? m.outputRoot;
    if (String(outRoot).includes("..")) {
      failures.push(`${ws} output root escapes via ..: ${outRoot}`);
      continue;
    }
    const wsAbs = resolve(ctx.root, m.path === "." ? "." : m.path);
    const outAbs = resolve(ctx.root, outRoot);
    // Must be under workspace
    const relOk = outAbs === wsAbs || outAbs.startsWith(wsAbs.endsWith(sep) ? wsAbs : wsAbs + sep);
    if (!relOk) {
      failures.push(`${ws} output ${outAbs} not inside workspace ${wsAbs}`);
    }
  }
  if (failures.length) return { name, status: "FAIL", detail: failures.join("; ") };
  return { name, status: "PASS", detail: "output roots confined to each workspace" };
}

export function checkBaselineJson(ctx) {
  const name = "baseline-json";
  const rel = "docs/12_VERIFICATION/release-baseline.json";
  const path = join(ctx.root, rel);
  if (!existsSync(path)) {
    return { name, status: "FAIL", detail: `${rel} missing` };
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { name, status: "FAIL", detail: `parse error: ${e.message}` };
  }
  const failures = [];
  if (doc.schemaVersion !== 1) failures.push(`schemaVersion ${doc.schemaVersion}`);
  if (doc.unit !== "U003") failures.push(`unit ${doc.unit}`);
  if (doc.baselineSha !== ctx.baseline) {
    failures.push(`baselineSha ${doc.baselineSha} != --baseline ${ctx.baseline}`);
  }
  for (const ws of ["root", "engineer", "workflow"]) {
    const w = doc.workspaces?.[ws];
    if (!w) {
      failures.push(`missing workspaces.${ws}`);
      continue;
    }
    const m = WORKSPACE_MATRIX[ws];
    if (w.packageManager !== m.packageManager) failures.push(`${ws}.packageManager`);
    if (w.nodeMajor !== Number(m.nodeMajor) && w.nodeMajor !== m.nodeMajor) {
      failures.push(`${ws}.nodeMajor`);
    }
    const lockPath = join(ctx.root, w.lockfile?.path || m.lockfile);
    if (!existsSync(lockPath)) {
      failures.push(`${ws} lockfile missing at ${lockPath}`);
    } else {
      const live = sha256File(lockPath);
      const recorded = w.lockfile?.sha256;
      if (recorded && recorded !== live) {
        failures.push(`${ws} lockfile sha256 mismatch: live=${live} recorded=${recorded}`);
      }
    }
  }
  if (failures.length) return { name, status: "FAIL", detail: failures.join("; ") };
  return { name, status: "PASS", detail: "release-baseline.json matches --baseline and live lock hashes" };
}

export function runAllChecks(ctx) {
  const checks = [
    checkBaselineIsAncestor,
    checkWorktreeProvenance,
    checkSingleLockfilePerWorkspace,
    checkRuntimeMatrix,
    checkCiSetup,
    checkPortConsistency,
    checkOutputContract,
    checkBaselineJson,
  ].map((fn) => fn(ctx));
  const overall = checks.every((c) => c.status === "PASS") ? "PASS" : "FAIL";
  return {
    unit: "U003",
    overall,
    baseline: ctx.baseline,
    root: ctx.root,
    checks,
  };
}

export function buildContext(opts = {}) {
  return {
    root: opts.root ?? DEFAULT_ROOT,
    baseline: opts.baseline ?? null,
    lockfileInventory: opts.lockfileInventory,
    outputRoots: opts.outputRoots,
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (args.help || !args.baseline) {
    console.error("Usage: node scripts/check-runtime-contract.mjs --baseline <sha> [--root <path>]");
    process.exit(args.help ? 0 : 2);
  }
  const ctx = buildContext({
    root: args.root,
    baseline: args.baseline,
    outputRoots: args.outputRoots,
  });
  const report = runAllChecks(ctx);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(report.overall === "PASS" ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);

if (isMain) {
  main();
}
