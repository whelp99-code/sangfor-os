import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateProductionReadiness } from "./verify-production-readiness.mjs";

const candidateSha = "a".repeat(40);

function fixture() {
  const directory = join(tmpdir(), `production-readiness-${process.pid}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(directory);
  const artifact = Buffer.from("redacted external staging evidence\n");
  const finalAcceptance = { schemaVersion: 1, authority: "AUTHORITATIVE_MIRROR_INTERNAL", candidateSha, state: "LOCAL_PASS_EXTERNAL_PENDING", autonomousPassed: 98, manualPending: 1, cleanup: "PASS", runId: "u076-final", contextHash: "b".repeat(64), aliasMapHash: "c".repeat(64), createdAt: "2026-07-28T00:00:00Z" };
  const finalAcceptanceBytes = Buffer.from(`${JSON.stringify(finalAcceptance)}\n`);
  const finalAcceptanceSha256 = createHash("sha256").update(finalAcceptanceBytes).digest("hex");
  writeFileSync(join(directory, "final.json"), finalAcceptanceBytes);
  writeFileSync(join(directory, "evidence.json"), artifact);
  return {
    directory,
    input: {
      candidateSha,
      finalAcceptance,
      finalAcceptanceSha256,
      externalReceipt: {
        schemaVersion: 1, candidateSha, manifestId: "AC-DOD-09", runId: "u076-final", ownerUnit: "U076", localAcceptanceSha256: finalAcceptanceSha256, verificationState: "MANUAL_EXTERNAL_PASS", approvalRequired: true, executed: true, result: "PASS", issuedAt: "2026-07-28T00:02:00Z",
        approval: { id: "approval-1", approvedBy: "release-owner", approvedAt: "2026-07-28T00:01:00Z" },
        commands: [{ argv: ["connector-smoke", "--read-only"], exitCode: 0, testCount: 1 }],
        artifactHashes: [{ path: "evidence.json", sha256: createHash("sha256").update(artifact).digest("hex"), bytes: artifact.length }],
      },
      externalReceiptPath: join(directory, "receipt.json"),
    },
  };
}

describe("production readiness evidence", () => {
  it("accepts candidate-bound local and approved external evidence", () => {
    const value = fixture();
    try { assert.equal(validateProductionReadiness(value.input).ok, true); } finally { rmSync(value.directory, { recursive: true }); }
  });
  it("rejects pending external evidence and stale artifact hashes", () => {
    const value = fixture();
    value.input.externalReceipt.verificationState = "MANUAL_EXTERNAL_PENDING";
    value.input.externalReceipt.artifactHashes[0].sha256 = "0".repeat(64);
    try { assert.throws(() => validateProductionReadiness(value.input), /MANUAL_EXTERNAL_PASS|artifact mismatch/u); } finally { rmSync(value.directory, { recursive: true }); }
  });
  it("rejects reuse against a different local acceptance file or run", () => {
    const value = fixture();
    value.input.externalReceipt.localAcceptanceSha256 = "0".repeat(64);
    value.input.externalReceipt.runId = "stale-run";
    try { assert.throws(() => validateProductionReadiness(value.input), /run identity|exact local acceptance/u); } finally { rmSync(value.directory, { recursive: true }); }
  });
});
