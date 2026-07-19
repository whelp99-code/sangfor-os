/**
 * U007 — scan tracked package.json scripts.test for false-green patterns.
 * Exit non-zero when any package uses echo / No tests / --if-present / || true / exit 0.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FALSE_GREEN_RE =
  /no\s*tests?|^\s*echo\b|--if-present|\|\|\s*true\b|\bexit\s+0\b/i;

/**
 * @param {string} script
 */
export function isFalseGreenTestScript(script) {
  if (typeof script !== "string") return true;
  return FALSE_GREEN_RE.test(script);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function listPackageManifestPaths(root = ROOT) {
  /** @type {string[]} */
  const paths = [];
  const rootPkg = join(root, "package.json");
  paths.push(rootPkg);

  for (const base of ["apps", "packages"]) {
    const dir = join(root, base);
    let entries = [];
    try {
      entries = readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    } catch {
      continue;
    }
    for (const name of entries) {
      const pkgPath = join(dir, name, "package.json");
      try {
        if (statSync(pkgPath).isFile()) paths.push(pkgPath);
      } catch {
        // skip
      }
    }
  }

  for (const service of [
    "services/sangfor-engineer-mcp/package.json",
    "services/sangfor-mcp-workflow/package.json",
  ]) {
    const p = join(root, service);
    try {
      if (statSync(p).isFile()) paths.push(p);
    } catch {
      // skip
    }
  }

  return paths;
}

/**
 * @param {string} root
 * @returns {{ findings: Array<{name:string,path:string,script:string}>, ok: boolean }}
 */
export function scanFalseGreenTests(root = ROOT) {
  const findings = [];
  for (const abs of listPackageManifestPaths(root)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(abs, "utf8"));
    } catch {
      continue;
    }
    const script = pkg?.scripts?.test;
    if (script === undefined) continue;
    if (isFalseGreenTestScript(String(script))) {
      findings.push({
        name: typeof pkg.name === "string" ? pkg.name : relative(root, abs),
        path: relative(root, abs).split("\\").join("/"),
        script: String(script),
      });
    }
  }
  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { findings, ok: findings.length === 0 };
}

/**
 * Fixture baseline packages that must be detectable by the scanner logic.
 * Used by unit tests with synthetic package trees.
 */
export const BASELINE_FALSE_GREEN_PACKAGES = Object.freeze([
  "@sangfor/api-utils",
  "@sangfor/persona",
  "@sangfor/ui",
  "@sangfor/mail-intelligence",
  "@sangfor/config",
  "@sangfor/health",
]);

function main() {
  const { findings, ok } = scanFalseGreenTests(ROOT);
  process.stdout.write(JSON.stringify({ findings, ok }, null, 2) + "\n");
  if (!ok) {
    for (const f of findings) {
      process.stderr.write(
        `FALSE_GREEN_TEST_SCRIPT ${f.package ?? f.name} ${f.path} ${JSON.stringify(f.script)}\n`,
      );
    }
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
