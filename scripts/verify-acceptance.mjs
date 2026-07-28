import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[a-f0-9]{40}$/;
const ALIAS_RECEIPT_KEYS = [
  "alias",
  "artifactHashes",
  "candidateSha",
  "cleanup",
  "createdAt",
  "databaseProvisioned",
  "executionOwnerUnit",
  "manifestRowIds",
  "owner",
  "result",
  "runId",
  "schemaVersion",
  "skipped",
  "stepResultHashes",
  "testCount",
];
const MANUAL_RECEIPT_KEYS = [
  "approvalRequired",
  "candidateSha",
  "executed",
  "issuedAt",
  "manifestId",
  "ownerUnit",
  "reason",
  "result",
  "runId",
  "schemaVersion",
  "verificationState",
];
const SHA64 = /^[a-f0-9]{64}$/;

export class AcceptanceVerificationError extends Error {}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sorted = (values) => [...values].sort();
const exactKeys = (value, keys) =>
  value && typeof value === "object" && !Array.isArray(value) &&
  same(Object.keys(value).sort(), [...keys].sort());

export function verifyAcceptanceSet({
  expectedAliasCount = 23,
  candidateSha,
  manifestRows,
  aliasEntries,
  aliasReceipts,
  manualReceipt,
}) {
  if (!SHA40.test(candidateSha ?? "")) {
    throw new AcceptanceVerificationError("candidate SHA must be lowercase 40-hex");
  }
  if (!Array.isArray(manifestRows) || manifestRows.length !== 99) {
    throw new AcceptanceVerificationError("exactly 99 manifest rows are required");
  }
  const ids = manifestRows.map((row) => row?.id);
  if (new Set(ids).size !== ids.length) {
    throw new AcceptanceVerificationError("duplicate manifest ID");
  }
  const autonomous = manifestRows.filter(
    (row) => row.verificationState === "AUTONOMOUS_LOCAL",
  );
  const manual = manifestRows.filter(
    (row) => row.verificationState !== "AUTONOMOUS_LOCAL",
  );
  if (
    autonomous.length !== 98 ||
    manual.length !== 1 ||
    manual[0]?.id !== "AC-DOD-09" ||
    manual[0]?.verificationState !== "MANUAL_EXTERNAL_PENDING"
  ) {
    throw new AcceptanceVerificationError(
      "manifest must contain 98 autonomous rows and only AC-DOD-09 pending",
    );
  }
  if (
    !Array.isArray(aliasEntries) ||
    aliasEntries.length !== expectedAliasCount ||
    new Set(aliasEntries.map((entry) => entry.alias)).size !== expectedAliasCount
  ) {
    throw new AcceptanceVerificationError(
      `exactly ${expectedAliasCount} unique alias entries are required`,
    );
  }
  const claimed = aliasEntries.flatMap((entry) => entry.manifestRowIds ?? []);
  if (
    claimed.length !== 99 ||
    new Set(claimed).size !== 99 ||
    !same(sorted(claimed), sorted(ids))
  ) {
    throw new AcceptanceVerificationError(
      "alias entries must form one disjoint complete 99-row partition",
    );
  }
  if (
    !Array.isArray(aliasReceipts) ||
    aliasReceipts.length !== expectedAliasCount ||
    new Set(aliasReceipts.map((receipt) => receipt.alias)).size !== expectedAliasCount
  ) {
    throw new AcceptanceVerificationError(
      `exactly ${expectedAliasCount} unique alias receipts are required`,
    );
  }
  const passedRows = [];
  for (const entry of aliasEntries) {
    const receipt = aliasReceipts.find((candidate) => candidate.alias === entry.alias);
    if (!exactKeys(receipt, ALIAS_RECEIPT_KEYS)) {
      throw new AcceptanceVerificationError(`${entry.alias} receipt fields drift`);
    }
    if (receipt.candidateSha !== candidateSha) {
      throw new AcceptanceVerificationError(`${entry.alias} candidate SHA mismatch`);
    }
    if (
      receipt.schemaVersion !== 1 ||
      receipt.owner !== entry.owner ||
      receipt.executionOwnerUnit !== entry.executionOwnerUnit ||
      typeof receipt.runId !== "string" ||
      receipt.runId.length === 0 ||
      typeof receipt.databaseProvisioned !== "boolean" ||
      Number.isNaN(Date.parse(receipt.createdAt)) ||
      !Array.isArray(receipt.stepResultHashes) ||
      receipt.stepResultHashes.length === 0 ||
      !receipt.stepResultHashes.every((item) => typeof item.id === "string" && SHA64.test(item.sha256 ?? "")) ||
      !Array.isArray(receipt.artifactHashes) ||
      receipt.artifactHashes.length === 0 ||
      !receipt.artifactHashes.every((item) => typeof item.path === "string" && Number.isInteger(item.bytes) && item.bytes > 0 && SHA64.test(item.sha256 ?? ""))
    ) {
      throw new AcceptanceVerificationError(`${entry.alias} receipt identity/artifact binding invalid`);
    }
    if (
      receipt.result !== "PASS" ||
      !Number.isInteger(receipt.testCount) ||
      receipt.testCount <= 0 ||
      receipt.skipped !== 0
    ) {
      throw new AcceptanceVerificationError(
        `${entry.alias} must prove a strict nonzero-test PASS`,
      );
    }
    if (
      !receipt.cleanup ||
      receipt.cleanup.result !== "PASS" ||
      receipt.cleanup.resources !== 0
    ) {
      throw new AcceptanceVerificationError(`${entry.alias} cleanup must PASS`);
    }
    const expectedRows = entry.manifestRowIds.filter((id) => id !== "AC-DOD-09");
    if (!same(sorted(receipt.manifestRowIds), sorted(expectedRows))) {
      throw new AcceptanceVerificationError(`${entry.alias} autonomous row partition mismatch`);
    }
    passedRows.push(...receipt.manifestRowIds);
  }
  if (
    passedRows.length !== 98 ||
    new Set(passedRows).size !== 98 ||
    !same(sorted(passedRows), sorted(autonomous.map((row) => row.id)))
  ) {
    throw new AcceptanceVerificationError(
      "alias receipts must prove all 98 autonomous rows exactly once",
    );
  }
  if (!exactKeys(manualReceipt, MANUAL_RECEIPT_KEYS)) {
    throw new AcceptanceVerificationError("manual pending receipt fields drift");
  }
  if (
    manualReceipt.manifestId !== "AC-DOD-09" ||
    manualReceipt.schemaVersion !== 1 ||
    manualReceipt.candidateSha !== candidateSha ||
    typeof manualReceipt.runId !== "string" ||
    manualReceipt.runId.length === 0 ||
    manualReceipt.ownerUnit !== "U076" ||
    manualReceipt.verificationState !== "MANUAL_EXTERNAL_PENDING" ||
    manualReceipt.approvalRequired !== true ||
    manualReceipt.executed !== false ||
    manualReceipt.result !== "PENDING" ||
    typeof manualReceipt.reason !== "string" ||
    manualReceipt.reason.length === 0 ||
    Number.isNaN(Date.parse(manualReceipt.issuedAt))
  ) {
    throw new AcceptanceVerificationError(
      "AC-DOD-09 must remain an unexecuted manual external pending gate",
    );
  }
  return Object.freeze({
    candidateSha,
    state: "LOCAL_PASS_EXTERNAL_PENDING",
    autonomousPassed: 98,
    manualPending: 1,
    aliasCount: expectedAliasCount,
  });
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new AcceptanceVerificationError(
        "usage: verify-acceptance --candidate-sha SHA --manifest FILE --aliases FILE --evidence-dir DIR [--output FILE]",
      );
    }
    values[flag.slice(2)] = value;
  }
  return values;
}

export async function verifyAcceptanceEvidence({
  candidateSha,
  manifestFile,
  aliasesFile,
  evidenceDir,
}) {
  const manifestRows = JSON.parse(await readFile(manifestFile, "utf8"));
  const aliasEntries = JSON.parse(await readFile(aliasesFile, "utf8"));
  const aliasReceipts = await Promise.all(
    aliasEntries.map(async ({ alias }) =>
      JSON.parse(
        await readFile(path.join(evidenceDir, "final-sha", alias, "receipt.json"), "utf8"),
      ),
    ),
  );
  const manualReceipt = JSON.parse(
    await readFile(path.join(evidenceDir, "manual-external-staging.json"), "utf8"),
  );
  return verifyAcceptanceSet({
    candidateSha,
    manifestRows,
    aliasEntries,
    aliasReceipts,
    manualReceipt,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifyAcceptanceEvidence({
    candidateSha: args["candidate-sha"],
    manifestFile: path.resolve(args.manifest),
    aliasesFile: path.resolve(args.aliases),
    evidenceDir: path.resolve(args["evidence-dir"]),
  });
  const output = {
    schemaVersion: 1,
    authority: process.env.U076_AUTHORITATIVE === "1" ? "AUTHORITATIVE" : "DIAGNOSTIC_ONLY",
    ...result,
    verifiedAt: new Date().toISOString(),
  };
  if (args.output) await writeFile(path.resolve(args.output), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof AcceptanceVerificationError ? 64 : 70;
  });
}
