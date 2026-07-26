import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPECTED_CELL_KEYS,
  generateEvidenceReceipt,
  verifyAxeResults,
  verifySnapshotInventory,
} from "./verify-ux-evidence.mjs";

describe("U066 verify-ux-evidence", () => {
  const directories = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function makeEvidence() {
    const root = mkdtempSync(join(tmpdir(), "u066-test-"));
    directories.push(root);
    const screenshots = join(root, "screenshots");
    mkdirSync(screenshots);
    const digests = EXPECTED_CELL_KEYS.map((cell) => {
      const content = Buffer.from(`png:${cell}`);
      writeFileSync(join(screenshots, `${cell}.png`), content);
      return { cell, file: `${cell}.png`, sha256: createHash("sha256").update(content).digest("hex") };
    });
    writeFileSync(join(root, "snapshot-digests.json"), JSON.stringify(digests));
    writeFileSync(join(root, "axe-results.json"), JSON.stringify(
      EXPECTED_CELL_KEYS.map((cell) => ({ cell, critical: 0, serious: 0, moderate: 0, minor: 0, violations: [] })),
    ));
    return { root, screenshots };
  }

  it("requires exactly 56 entries, 65 expanded cases, and 195 unique cells", () => {
    expect(EXPECTED_CELL_KEYS).toHaveLength(195);
    expect(new Set(EXPECTED_CELL_KEYS).size).toBe(195);
    expect(EXPECTED_CELL_KEYS.filter((key) => key.startsWith("S01:"))).toHaveLength(30);
  });

  it("accepts only a complete exact-set bundle", () => {
    const evidence = makeEvidence();
    expect(generateEvidenceReceipt(evidence.screenshots, evidence.root).overallPassed).toBe(true);
  });

  it("rejects a missing or duplicate axe cell and an empty axe array", () => {
    const evidence = makeEvidence();
    const axePath = join(evidence.root, "axe-results.json");
    const records = JSON.parse(readFileSync(axePath, "utf8"));
    writeFileSync(axePath, JSON.stringify([...records.slice(1), records[1]]));
    const duplicate = verifyAxeResults(evidence.root);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.keys.missing).toContain(EXPECTED_CELL_KEYS[0]);
    expect(duplicate.keys.duplicates).toContain(EXPECTED_CELL_KEYS[1]);
    writeFileSync(axePath, "[]");
    expect(verifyAxeResults(evidence.root)).toMatchObject({ ok: false, totalScanned: 0 });
  });

  it("rejects axe violations and malformed records", () => {
    const evidence = makeEvidence();
    const axePath = join(evidence.root, "axe-results.json");
    const records = JSON.parse(readFileSync(axePath, "utf8"));
    records[0].critical = 1;
    delete records[1].violations;
    writeFileSync(axePath, JSON.stringify(records));
    const result = verifyAxeResults(evidence.root);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain(EXPECTED_CELL_KEYS[0]);
    expect(result.malformed).toContain(EXPECTED_CELL_KEYS[1]);
  });

  it("rejects missing, extra, and digest-mismatched screenshots", () => {
    const evidence = makeEvidence();
    const digestPath = join(evidence.root, "snapshot-digests.json");
    const records = JSON.parse(readFileSync(digestPath, "utf8"));
    records[0].sha256 = "0".repeat(64);
    records[1].cell = "EXTRA@375x812";
    records[1].file = "EXTRA@375x812.png";
    writeFileSync(digestPath, JSON.stringify(records));
    const result = verifySnapshotInventory(evidence.screenshots, evidence.root);
    expect(result.ok).toBe(false);
    expect(result.invalidDigests).toContain(EXPECTED_CELL_KEYS[0]);
    expect(result.digests.extra).toContain("EXTRA@375x812");
    expect(result.digests.missing).toContain(EXPECTED_CELL_KEYS[1]);
  });

  it("rejects absent evidence files", () => {
    expect(verifySnapshotInventory("/nonexistent/path")).toMatchObject({ ok: false, cells: 0 });
    expect(verifyAxeResults("/nonexistent/path")).toMatchObject({ ok: false, totalScanned: 0 });
  });
});
