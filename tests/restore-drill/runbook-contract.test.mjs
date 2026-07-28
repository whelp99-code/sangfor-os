import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const RUNBOOK_PATH = join(REPO_ROOT, "docs/12_VERIFICATION/restore-drill-runbook.md");
const UNSAFE_CASES_PATH = join(REPO_ROOT, "tests/restore-drill/fixtures/runbook-unsafe-cases.json");

const FORBIDDEN_PATTERNS = [
  { name: "docker keyword", re: /\bdocker\b/i },
  { name: "docker-compose keyword", re: /\bdocker-compose\b/i },
  { name: "docker compose exec", re: /docker\s+compose\s+exec/i },
  { name: "pg_dump", re: /\bpg_dump\b/i },
  { name: "pg_restore", re: /\bpg_restore\b/i },
  { name: "psql", re: /\bpsql\b/i },
  { name: "createdb", re: /\bcreatedb\b/i },
  { name: "dropdb", re: /\bdropdb\b/i },
  { name: "DATABASE_URL", re: /DATABASE_URL/ },
  { name: "~/Backups", re: /~\/Backups/ },
  { name: "/Users/ absolute path", re: /\/Users\// },
  { name: "DROP DATABASE", re: /DROP DATABASE/i },
  { name: "fixed container name", re: /\bsangfor-postgres\b/ },
  { name: "fixed database name", re: /\bsangfor_os\b/ },
  { name: "fixed volume name", re: /\bsangfor_pgdata\b/ },
];

const REQUIRED_MARKERS = [
  "격리 Postgres 헬퍼",
  "restore:drill",
  "fixture",
  "라벨",
  "MANUAL_EXTERNAL_PENDING",
  "0개로 수렴",
];

function scanRunbookText(text) {
  const violations = FORBIDDEN_PATTERNS.filter((pattern) => pattern.re.test(text)).map((pattern) => pattern.name);
  return { safe: violations.length === 0, violations };
}

describe("restore-drill-runbook safety contract", () => {
  it("the tracked runbook file exists at its historical path", () => {
    const tracked = execFileSync("git", ["ls-files", "--error-unmatch", "docs/12_VERIFICATION/restore-drill-runbook.md"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.match(tracked.trim(), /restore-drill-runbook\.md$/);
  });

  it("the current runbook passes the safety scan clean", () => {
    const text = readFileSync(RUNBOOK_PATH, "utf8");
    const scan = scanRunbookText(text);
    assert.deepEqual(scan.violations, [], `runbook must not contain: ${scan.violations.join(", ")}`);
  });

  it("the current runbook documents the required safety authorities", () => {
    const text = readFileSync(RUNBOOK_PATH, "utf8");
    for (const marker of REQUIRED_MARKERS) {
      assert.ok(text.includes(marker), `runbook must mention "${marker}"`);
    }
  });

  const unsafeCases = JSON.parse(readFileSync(UNSAFE_CASES_PATH, "utf8"));
  assert.ok(Array.isArray(unsafeCases) && unsafeCases.length > 0, "runbook-unsafe-cases.json must be a non-empty array");

  for (const testCase of unsafeCases) {
    it(`rejects injected unsafe case: ${testCase.name}`, () => {
      const base = readFileSync(RUNBOOK_PATH, "utf8");
      const tempDir = mkdtempSync(join(tmpdir(), "u009-runbook-"));
      try {
        const tempPath = join(tempDir, "restore-drill-runbook.md");
        writeFileSync(tempPath, `${base}\n\n${testCase.snippet}\n`);
        const scan = scanRunbookText(readFileSync(tempPath, "utf8"));
        assert.equal(scan.safe, false, `case "${testCase.name}" must be detected as unsafe`);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  }
});
