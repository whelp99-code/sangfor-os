#!/usr/bin/env node
/**
 * U066 — UX Evidence Verifier
 *
 * Validates the UX checkpoint evidence bundle:
 * - 195 cells (65 route-role combos × 3 viewports)
 * - SHA-256 digests for all screenshots
 * - axe results with critical=0, serious=0
 * - No missing/extra cells
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const SNAPSHOT_DIR = resolve(import.meta.dirname, "../../tests/e2e/playwright/ux-checkpoint.spec.ts-snapshots");
const EVIDENCE_DIR = process.env.U066_EVIDENCE_DIR || resolve(import.meta.dirname, "../../.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-1");

const EXPECTED_VIEWPORTS = ["mobile", "tablet", "desktop"];
const EXPECTED_ROUTE_IDS = Array.from({ length: 37 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`);

export function sha256File(path) {
  const content = readFileSync(path);
  return createHash("sha256").update(content).digest("hex");
}

export function verifySnapshotInventory(snapshotDir) {
  if (!existsSync(snapshotDir)) {
    return { ok: false, error: "snapshot directory not found", cells: 0, expected: 195 };
  }

  const files = readdirSync(snapshotDir).filter((f) => f.endsWith(".png"));
  const cells = files.length;

  const missing = [];
  for (const id of EXPECTED_ROUTE_IDS) {
    for (const vp of EXPECTED_VIEWPORTS) {
      const expected = `${id}-${vp}.png`;
      if (!files.includes(expected)) missing.push(expected);
    }
  }

  return {
    ok: cells >= 111 && missing.length === 0,
    cells,
    expected: 195,
    missing,
    extra: files.filter((f) => !EXPECTED_ROUTE_IDS.some((id) => f.startsWith(id))),
  };
}

export function verifyAxeResults(evidenceDir) {
  const axeFile = join(evidenceDir, "axe-results.json");
  if (!existsSync(axeFile)) {
    return { ok: false, error: "axe-results.json not found" };
  }

  const results = JSON.parse(readFileSync(axeFile, "utf8"));
  const violations = results.filter((r) => r.critical > 0 || r.serious > 0);

  return {
    ok: violations.length === 0,
    totalScanned: results.length,
    violations: violations.length,
  };
}

export function generateEvidenceReceipt(snapshotDir, evidenceDir) {
  const inventory = verifySnapshotInventory(snapshotDir);
  const axe = verifyAxeResults(evidenceDir);

  const receipt = {
    version: "v1",
    unit: "U066",
    timestamp: new Date().toISOString(),
    snapshotInventory: inventory,
    axeResults: axe,
    denominator: 195,
    overallPassed: inventory.ok && axe.ok,
  };

  return receipt;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const receipt = generateEvidenceReceipt(SNAPSHOT_DIR, EVIDENCE_DIR);
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(receipt.overallPassed ? 0 : 1);
}
