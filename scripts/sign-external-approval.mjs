#!/usr/bin/env node
/**
 * Turns the campaign's PENDING AC-DOD-09 receipt into the signed
 * MANUAL_EXTERNAL_PASS receipt `verify-production-readiness.mjs` demands.
 *
 * AC-DOD-09 is "staging 배포 검증" — a human confirming the staging deployment.
 * U076 deliberately leaves it unexecuted because the approval is owner-controlled.
 *
 * This tool deliberately cannot invent evidence:
 *   - command results are read from a file the caller produced by actually
 *     running them, and every entry must already carry exitCode 0 and a positive
 *     test count, or this refuses;
 *   - artifact hashes are computed from bytes on disk, never asserted;
 *   - the identity fields are copied from the campaign's own pending receipt, so
 *     a receipt can never be built for a candidate or run the campaign did not
 *     actually produce.
 *
 * Usage:
 *   node scripts/sign-external-approval.mjs \
 *     --attempt-dir <dir with final-acceptance.json> \
 *     --commands <executed-commands.json> \
 *     --approval-key <ed25519 private pem> \
 *     --key-id <keyId registered in the production authority> \
 *     --approved-by <name> \
 *     --output <external-receipt.json>
 */
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./lib/production-authority.mjs";
import { signProductionApprovalReceipt } from "./verify-production-readiness.mjs";

const GATE_FILE = "nonce-authority-release-gate.json";

export class ApprovalBuildError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = "ApprovalBuildError";
    this.exitCode = exitCode;
  }
}

/** Every command must already prove a successful run with real tests behind it. */
export function validateExecutedCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new ApprovalBuildError(64, "commands must be a non-empty array of executed results");
  }
  for (const command of commands) {
    if (!Array.isArray(command?.argv) || command.argv.length === 0) {
      throw new ApprovalBuildError(64, "each command needs the argv that was executed");
    }
    if (command.exitCode !== 0) {
      throw new ApprovalBuildError(65, `refusing to approve on a failed command: ${command.argv.join(" ")}`);
    }
    if (!Number.isInteger(command.testCount) || command.testCount <= 0) {
      throw new ApprovalBuildError(65, `command proves no tests: ${command.argv.join(" ")}`);
    }
  }
  return commands.map((command) => ({ argv: command.argv, exitCode: 0, testCount: command.testCount }));
}

export function buildExternalReceipt({ pending, finalAcceptanceBytes, gateBytes, commands, approvedBy, now }) {
  const localAcceptanceSha256 = createHash("sha256").update(finalAcceptanceBytes).digest("hex");
  const approvedAt = new Date(now);
  const finalAcceptance = JSON.parse(finalAcceptanceBytes.toString("utf8"));
  if (Date.parse(finalAcceptance.createdAt) > approvedAt.getTime()) {
    throw new ApprovalBuildError(65, "cannot approve evidence that claims to be from the future");
  }
  return {
    schemaVersion: 1,
    candidateSha: pending.candidateSha,
    manifestId: pending.manifestId,
    runId: pending.runId,
    ownerUnit: pending.ownerUnit,
    localAcceptanceSha256,
    verificationState: "MANUAL_EXTERNAL_PASS",
    approvalRequired: true,
    executed: true,
    result: "PASS",
    approval: {
      id: `ac-dod-09-${pending.runId}`,
      approvedBy,
      approvedAt: approvedAt.toISOString(),
      issuer: null, // filled by the caller from the authority
      nonce: `${randomBytes(30).toString("base64url")}`,
    },
    issuedAt: new Date(approvedAt.getTime() + 1000).toISOString(),
    commands,
    artifactHashes: [
      {
        path: GATE_FILE,
        sha256: createHash("sha256").update(gateBytes).digest("hex"),
        bytes: gateBytes.length,
      },
    ],
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new ApprovalBuildError(64, "invalid arguments");
    }
    values[argv[index].slice(2)] = argv[index + 1];
  }
  return values;
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const { loadProductionAuthority } = await import("./lib/production-authority.mjs");
  const attemptDir = resolve(values["attempt-dir"]);
  const output = resolve(values.output);

  const { authority } = loadProductionAuthority();
  const keyId = values["key-id"];
  const entry = authority.approvalKeys?.[keyId];
  if (entry?.status !== "verify") throw new ApprovalBuildError(64, `approval key ${keyId} is not registered as verify`);

  const finalAcceptanceBytes = readFileSync(join(attemptDir, "final-acceptance.json"));
  const gateBytes = readFileSync(join(attemptDir, GATE_FILE));
  const pending = JSON.parse(readFileSync(join(attemptDir, "manual-external-staging.json"), "utf8"));
  if (pending.manifestId !== "AC-DOD-09" || pending.approvalRequired !== true) {
    throw new ApprovalBuildError(64, "pending receipt is not the AC-DOD-09 approval request");
  }

  const commands = validateExecutedCommands(JSON.parse(readFileSync(resolve(values.commands), "utf8")));
  const receipt = buildExternalReceipt({
    pending,
    finalAcceptanceBytes,
    gateBytes,
    commands,
    approvedBy: values["approved-by"],
    now: Date.now(),
  });
  receipt.approval.issuer = authority.approvalIssuer;

  // The gate re-hashes every artifact relative to the receipt's own directory.
  copyFileSync(join(attemptDir, GATE_FILE), join(dirname(output), GATE_FILE));

  const value = signProductionApprovalReceipt(receipt, readFileSync(resolve(values["approval-key"])));
  const signed = { ...receipt, signature: { keyId, algorithm: "Ed25519", value } };
  writeFileSync(output, `${JSON.stringify(signed, null, 2)}\n`, { mode: 0o600 });

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      output,
      candidateSha: signed.candidateSha,
      runId: signed.runId,
      keyId,
      commands: signed.commands.length,
      receiptSha256: createHash("sha256").update(canonicalJson(signed)).digest("hex"),
      gateArtifact: basename(join(dirname(output), GATE_FILE)),
    })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(error instanceof ApprovalBuildError ? error.exitCode : 70);
  });
}
