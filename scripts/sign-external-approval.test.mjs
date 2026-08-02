import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApprovalBuildError, buildExternalReceipt, validateExecutedCommands } from "./sign-external-approval.mjs";

const pending = {
  schemaVersion: 1,
  manifestId: "AC-DOD-09",
  candidateSha: "a".repeat(40),
  runId: "u076-main-1785687139548",
  ownerUnit: "U076",
  verificationState: "MANUAL_EXTERNAL_PENDING",
  approvalRequired: true,
  executed: false,
  result: "PENDING",
  reason: "External staging approval and execution are owner-controlled.",
  issuedAt: "2026-08-02T16:05:00.000Z",
};
const finalAcceptanceBytes = Buffer.from(
  JSON.stringify({ candidateSha: pending.candidateSha, runId: pending.runId, createdAt: "2026-08-02T16:00:00.000Z" }),
);
const gateBytes = Buffer.from('{"schemaVersion":1}');
const NOW = Date.parse("2026-08-02T17:00:00.000Z");
const okCommands = [{ argv: ["bash", "scripts/run-workspace-runtime.sh"], exitCode: 0, testCount: 12 }];

describe("validateExecutedCommands", () => {
  it("passes through a real successful run, keeping only the fields the gate reads", () => {
    assert.deepEqual(validateExecutedCommands([{ argv: ["a", "b"], exitCode: 0, testCount: 3, extra: "ignored" }]), [
      { argv: ["a", "b"], exitCode: 0, testCount: 3 },
    ]);
  });

  it("refuses to approve on a command that failed", () => {
    // The whole point of the receipt is that somebody verified staging. A
    // non-zero exit means they verified it does not work.
    assert.throws(
      () => validateExecutedCommands([{ argv: ["x"], exitCode: 1, testCount: 5 }]),
      (error) => error instanceof ApprovalBuildError && error.exitCode === 65,
    );
  });

  it("refuses a command that proves no tests", () => {
    for (const testCount of [0, -1, null, undefined, 1.5, "3"]) {
      assert.throws(
        () => validateExecutedCommands([{ argv: ["x"], exitCode: 0, testCount }]),
        (error) => error instanceof ApprovalBuildError,
      );
    }
  });

  it("refuses an empty or malformed command list", () => {
    for (const bad of [[], null, "commands", [{ exitCode: 0, testCount: 1 }], [{ argv: [], exitCode: 0, testCount: 1 }]]) {
      assert.throws(() => validateExecutedCommands(bad), (error) => error instanceof ApprovalBuildError);
    }
  });
});

describe("buildExternalReceipt", () => {
  const receipt = buildExternalReceipt({
    pending,
    finalAcceptanceBytes,
    gateBytes,
    commands: okCommands,
    approvedBy: "jm.park",
    now: NOW,
  });

  it("copies identity from the campaign's own pending receipt, never from an argument", () => {
    // A receipt must be impossible to mint for a candidate or run the campaign
    // did not actually produce.
    assert.equal(receipt.candidateSha, pending.candidateSha);
    assert.equal(receipt.runId, pending.runId);
    assert.equal(receipt.manifestId, "AC-DOD-09");
    assert.equal(receipt.ownerUnit, "U076");
  });

  it("binds itself to the exact acceptance bytes", () => {
    const other = buildExternalReceipt({
      pending,
      finalAcceptanceBytes: Buffer.concat([finalAcceptanceBytes, Buffer.from(" ")]),
      gateBytes,
      commands: okCommands,
      approvedBy: "jm.park",
      now: NOW,
    });
    assert.notEqual(receipt.localAcceptanceSha256, other.localAcceptanceSha256);
  });

  it("states execution and result explicitly", () => {
    assert.equal(receipt.verificationState, "MANUAL_EXTERNAL_PASS");
    assert.equal(receipt.executed, true);
    assert.equal(receipt.result, "PASS");
    assert.equal(receipt.approvalRequired, true);
  });

  it("orders the chronology the gate checks", () => {
    const created = Date.parse("2026-08-02T16:00:00.000Z");
    assert.ok(created <= Date.parse(receipt.approval.approvedAt));
    assert.ok(Date.parse(receipt.approval.approvedAt) <= Date.parse(receipt.issuedAt));
  });

  it("refuses to approve acceptance evidence dated in the future", () => {
    assert.throws(
      () =>
        buildExternalReceipt({
          pending,
          finalAcceptanceBytes: Buffer.from(JSON.stringify({ createdAt: "2030-01-01T00:00:00.000Z" })),
          gateBytes,
          commands: okCommands,
          approvedBy: "jm.park",
          now: NOW,
        }),
      (error) => error instanceof ApprovalBuildError && error.exitCode === 65,
    );
  });

  it("mints a nonce the authority will accept and never repeats it", () => {
    const nonces = new Set(
      Array.from({ length: 25 }, () =>
        buildExternalReceipt({ pending, finalAcceptanceBytes, gateBytes, commands: okCommands, approvedBy: "x", now: NOW })
          .approval.nonce,
      ),
    );
    assert.equal(nonces.size, 25);
    for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9._-]{32,128}$/u);
  });

  it("hashes the release gate artifact from its bytes", () => {
    assert.equal(receipt.artifactHashes.length, 1);
    assert.equal(receipt.artifactHashes[0].path, "nonce-authority-release-gate.json");
    assert.equal(receipt.artifactHashes[0].bytes, gateBytes.length);
    assert.match(receipt.artifactHashes[0].sha256, /^[a-f0-9]{64}$/u);
  });

  it("leaves the issuer unset for the caller to fill from the authority", () => {
    // The issuer must byte-match the authority's, so it is never guessed here.
    assert.equal(receipt.approval.issuer, null);
  });
});
