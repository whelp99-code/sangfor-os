import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BASELINE_FALSE_GREEN_PACKAGES,
  isFalseGreenTestScript,
  scanFalseGreenTests,
} from "./check-no-false-green-tests.mjs";

describe("check-no-false-green-tests", () => {
  it("detects echo / No tests / --if-present / || true / exit 0", () => {
    assert.equal(isFalseGreenTestScript('echo "No tests"'), true);
    assert.equal(isFalseGreenTestScript("echo No tests"), true);
    assert.equal(isFalseGreenTestScript("vitest run --if-present"), true);
    assert.equal(isFalseGreenTestScript("vitest run || true"), true);
    assert.equal(isFalseGreenTestScript("exit 0"), true);
    assert.equal(isFalseGreenTestScript("vitest run src/index.test.ts"), false);
  });

  it("fixture tree detects exact six baseline packages", () => {
    const root = mkdtempSync(join(tmpdir(), "u007-fg-"));
    try {
      mkdirSync(join(root, "packages"), { recursive: true });
      mkdirSync(join(root, "apps"), { recursive: true });
      mkdirSync(join(root, "services/sangfor-engineer-mcp"), { recursive: true });
      mkdirSync(join(root, "services/sangfor-mcp-workflow"), { recursive: true });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "root", scripts: { test: "pnpm -r test" } }),
      );
      writeFileSync(
        join(root, "services/sangfor-engineer-mcp/package.json"),
        JSON.stringify({ name: "eng", scripts: { test: "vitest run" } }),
      );
      writeFileSync(
        join(root, "services/sangfor-mcp-workflow/package.json"),
        JSON.stringify({ name: "wf", scripts: { test: "vitest run" } }),
      );

      const baselines = [
        ["api-utils", "@sangfor/api-utils", 'echo "No tests"'],
        ["persona", "@sangfor/persona", 'echo "No tests"'],
        ["ui", "@sangfor/ui", "echo No tests"],
        ["mail-intelligence", "@sangfor/mail-intelligence", "echo No tests"],
        ["config", "@sangfor/config", "exit 0"],
        ["health", "@sangfor/health", "true || true"],
      ];
      for (const [dir, name, script] of baselines) {
        mkdirSync(join(root, "packages", dir), { recursive: true });
        writeFileSync(
          join(root, "packages", dir, "package.json"),
          JSON.stringify({ name, scripts: { test: script } }),
        );
      }

      const { findings } = scanFalseGreenTests(root);
      const names = findings.map((f) => f.name).sort();
      const expected = [...BASELINE_FALSE_GREEN_PACKAGES].sort();
      assert.deepEqual(names, expected);

      // Hiding one package from fixture → test would fail (assert length 6)
      assert.equal(findings.length, 6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("repo scan excludes the U030-removed @sangfor/ui package", () => {
    const { findings } = scanFalseGreenTests();
    const ui = findings.find((f) => f.name === "@sangfor/ui");
    assert.equal(ui, undefined);
  });

  it("scanner baseline retains the false-green UI fixture without an allowlist", () => {
    assert.ok(BASELINE_FALSE_GREEN_PACKAGES.includes("@sangfor/ui"));
  });
});
