#!/usr/bin/env node
/** U066 exact-set evidence verifier. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROLES = [
  "ceo", "sales_manager", "account_manager", "presales_engineer", "solution_architect",
  "finance_manager", "delivery_engineer", "support_engineer", "security_officer", "system_admin",
];
const VIEWPORTS = ["375x812", "768x1024", "1280x900"];
const ROUTE_IDS = [
  ...Array.from({ length: 42 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 14 }, (_, index) => `D${String(index + 1).padStart(2, "0")}`),
];
const EXPANDED_CASE_IDS = [
  ...ROLES.map((role) => `S01:${role}`),
  ...ROUTE_IDS.filter((id) => id !== "S01"),
];
export const EXPECTED_CELL_KEYS = EXPANDED_CASE_IDS.flatMap((id) =>
  VIEWPORTS.map((viewport) => `${id}@${viewport}`),
);
const EXPECTED_CELL_SET = new Set(EXPECTED_CELL_KEYS);

if (ROUTE_IDS.length !== 56 || EXPANDED_CASE_IDS.length !== 65 || EXPECTED_CELL_SET.size !== 195) {
  throw new Error("U066 verifier inventory constants are invalid");
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function exactSetDiagnostics(actual) {
  const counts = new Map();
  for (const key of actual) counts.set(key, (counts.get(key) ?? 0) + 1);
  return {
    missing: EXPECTED_CELL_KEYS.filter((key) => !counts.has(key)),
    extra: [...counts.keys()].filter((key) => !EXPECTED_CELL_SET.has(key)),
    duplicates: [...counts.entries()].filter(([, count]) => count !== 1).map(([key]) => key),
  };
}

export function verifySnapshotInventory(snapshotDir, evidenceDir = resolve(snapshotDir, "..")) {
  if (!existsSync(snapshotDir)) {
    return { ok: false, error: "snapshot directory not found", cells: 0, expected: 195 };
  }
  const digestFile = join(evidenceDir, "snapshot-digests.json");
  if (!existsSync(digestFile)) {
    return { ok: false, error: "snapshot-digests.json not found", cells: 0, expected: 195 };
  }

  const files = readdirSync(snapshotDir).filter((file) => file.endsWith(".png"));
  const fileKeys = files.map((file) => file.slice(0, -4));
  const digests = JSON.parse(readFileSync(digestFile, "utf8"));
  if (!Array.isArray(digests)) {
    return { ok: false, error: "snapshot-digests.json must be an array", cells: files.length, expected: 195 };
  }

  const fileSet = exactSetDiagnostics(fileKeys);
  const digestSet = exactSetDiagnostics(digests.map((entry) => entry?.cell));
  const invalidDigests = digests.filter((entry) => {
    if (!entry || typeof entry.cell !== "string" || entry.file !== `${entry.cell}.png`) return true;
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) return true;
    const path = join(snapshotDir, entry.file);
    return !existsSync(path) || sha256File(path) !== entry.sha256;
  }).map((entry) => entry?.cell ?? "<invalid>");

  return {
    ok: files.length === 195 && digests.length === 195
      && fileSet.missing.length === 0 && fileSet.extra.length === 0 && fileSet.duplicates.length === 0
      && digestSet.missing.length === 0 && digestSet.extra.length === 0 && digestSet.duplicates.length === 0
      && invalidDigests.length === 0,
    cells: files.length,
    expected: 195,
    files: fileSet,
    digests: digestSet,
    invalidDigests,
  };
}

export function verifyAxeResults(evidenceDir) {
  const axeFile = join(evidenceDir, "axe-results.json");
  if (!existsSync(axeFile)) return { ok: false, error: "axe-results.json not found", totalScanned: 0 };

  const results = JSON.parse(readFileSync(axeFile, "utf8"));
  if (!Array.isArray(results) || results.length === 0) {
    return { ok: false, error: "axe-results.json must be a non-empty array", totalScanned: 0 };
  }
  const keys = exactSetDiagnostics(results.map((result) => result?.cell));
  const malformed = results.filter((result) =>
    !result || !Number.isInteger(result.critical) || !Number.isInteger(result.serious)
    || !Array.isArray(result.violations),
  ).map((result) => result?.cell ?? "<invalid>");
  const violations = results.filter((result) => result?.critical !== 0 || result?.serious !== 0)
    .map((result) => result?.cell ?? "<invalid>");

  return {
    ok: results.length === 195 && keys.missing.length === 0 && keys.extra.length === 0
      && keys.duplicates.length === 0 && malformed.length === 0 && violations.length === 0,
    totalScanned: results.length,
    expected: 195,
    keys,
    malformed,
    violations,
  };
}

export function generateEvidenceReceipt(snapshotDir, evidenceDir) {
  const inventory = verifySnapshotInventory(snapshotDir, evidenceDir);
  const axe = verifyAxeResults(evidenceDir);
  return {
    version: "v2",
    unit: "U066",
    timestamp: new Date().toISOString(),
    snapshotInventory: inventory,
    axeResults: axe,
    denominator: 195,
    overallPassed: inventory.ok && axe.ok,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const evidenceDir = process.env.U066_EVIDENCE_DIR
    ? resolve(process.env.U066_EVIDENCE_DIR)
    : resolve(import.meta.dirname, "../../.omo/evidence/sangfor-system-refactor-2026-07-15/U066/attempt-1");
  const receipt = generateEvidenceReceipt(join(evidenceDir, "screenshots"), evidenceDir);
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(receipt.overallPassed ? 0 : 1);
}
