import { describe, expect, it } from "vitest";
import { verifySnapshotInventory, verifyAxeResults, generateEvidenceReceipt } from "./verify-ux-evidence.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("U066 verify-ux-evidence", () => {
  const testDir = join(tmpdir(), `u066-test-${Date.now()}`);

  it("rejects missing snapshot directory", () => {
    const result = verifySnapshotInventory("/nonexistent/path");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("snapshot directory not found");
  });

  it("detects missing cells in snapshot inventory", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "S01-mobile.png"), "fake");
    const result = verifySnapshotInventory(testDir);
    expect(result.ok).toBe(false);
    expect(result.cells).toBe(1);
    expect(result.missing.length).toBeGreaterThan(0);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("rejects missing axe results", () => {
    const result = verifyAxeResults("/nonexistent/path");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("axe-results.json not found");
  });

  it("passes with clean axe results", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "axe-results.json"), JSON.stringify([
      { cell: "S01-mobile", critical: 0, serious: 0 },
      { cell: "S01-tablet", critical: 0, serious: 0 },
    ]));
    const result = verifyAxeResults(testDir);
    expect(result.ok).toBe(true);
    expect(result.totalScanned).toBe(2);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("fails with critical axe violations", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "axe-results.json"), JSON.stringify([
      { cell: "S01-mobile", critical: 1, serious: 0 },
    ]));
    const result = verifyAxeResults(testDir);
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(1);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("generates evidence receipt with correct denominator", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "axe-results.json"), JSON.stringify([]));
    const receipt = generateEvidenceReceipt("/nonexistent", testDir);
    expect(receipt.denominator).toBe(195);
    expect(receipt.unit).toBe("U066");
    expect(receipt.overallPassed).toBe(false);
    rmSync(testDir, { recursive: true, force: true });
  });
});
