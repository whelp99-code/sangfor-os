import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyAcceptanceSet } from "./verify-acceptance.mjs";

const SHA = "a".repeat(40);

function fixture() {
  const rows = Array.from({ length: 98 }, (_, index) => ({
    id: `AUTO-${String(index + 1).padStart(3, "0")}`,
    verificationState: "AUTONOMOUS_LOCAL",
    primaryTest: index < 97 ? "T-A" : "T-REL",
  }));
  rows.push({
    id: "AC-DOD-09",
    verificationState: "MANUAL_EXTERNAL_PENDING",
    primaryTest: "T-REL",
  });
  return {
    expectedAliasCount: 2,
    candidateSha: SHA,
    manifestRows: rows,
    aliasEntries: [
      { alias: "T-A", owner: "DOC-01", executionOwnerUnit: "U001", manifestRowIds: rows.slice(0, 97).map((row) => row.id) },
      { alias: "T-REL", owner: "REL-01", executionOwnerUnit: "U076", manifestRowIds: [rows[97].id, "AC-DOD-09"] },
    ],
    aliasReceipts: [
      {
        alias: "T-A",
        schemaVersion: 1,
        owner: "DOC-01",
        executionOwnerUnit: "U001",
        candidateSha: SHA,
        runId: "alias-a",
        manifestRowIds: rows.slice(0, 97).map((row) => row.id),
        stepResultHashes: [{ id: "step", sha256: "1".repeat(64) }],
        artifactHashes: [{ path: "steps/step/result.json", sha256: "2".repeat(64), bytes: 1 }],
        testCount: 97,
        skipped: 0,
        result: "PASS",
        databaseProvisioned: false,
        cleanup: { result: "PASS", resources: 0 },
        createdAt: "2026-07-26T00:00:00.000Z",
      },
      {
        alias: "T-REL",
        schemaVersion: 1,
        owner: "REL-01",
        executionOwnerUnit: "U076",
        candidateSha: SHA,
        runId: "alias-rel",
        manifestRowIds: [rows[97].id],
        stepResultHashes: [{ id: "step", sha256: "3".repeat(64) }],
        artifactHashes: [{ path: "steps/step/result.json", sha256: "4".repeat(64), bytes: 1 }],
        testCount: 1,
        skipped: 0,
        result: "PASS",
        databaseProvisioned: false,
        cleanup: { result: "PASS", resources: 0 },
        createdAt: "2026-07-26T00:00:00.000Z",
      },
    ],
    manualReceipt: {
      schemaVersion: 1,
      manifestId: "AC-DOD-09",
      candidateSha: SHA,
      runId: "U076-final-test",
      ownerUnit: "U076",
      verificationState: "MANUAL_EXTERNAL_PENDING",
      approvalRequired: true,
      executed: false,
      result: "PENDING",
      reason: "explicit external approval is required",
      issuedAt: "2026-07-26T00:00:00.000Z",
    },
  };
}

describe("strict U076 acceptance aggregation", () => {
  it("accepts exactly 98 autonomous rows plus AC-DOD-09 pending", () => {
    const result = verifyAcceptanceSet(fixture());
    assert.equal(result.state, "LOCAL_PASS_EXTERNAL_PENDING");
    assert.equal(result.autonomousPassed, 98);
    assert.equal(result.manualPending, 1);
  });

  for (const [name, mutate, pattern] of [
    ["duplicate ID", (value) => { value.manifestRows[1] = { ...value.manifestRows[0] }; }, /duplicate/i],
    ["missing row", (value) => value.manifestRows.splice(10, 1), /99 manifest rows/i],
    ["stale SHA", (value) => { value.aliasReceipts[0].candidateSha = "b".repeat(40); }, /candidate SHA/i],
    ["zero test", (value) => { value.aliasReceipts[0].testCount = 0; }, /nonzero/i],
    ["manual auto-pass", (value) => {
      value.manualReceipt.verificationState = "MANUAL_EXTERNAL_PASS";
      value.manualReceipt.executed = true;
      value.manualReceipt.result = "PASS";
    }, /pending/i],
  ]) {
    it(`rejects ${name}`, () => {
      const value = fixture();
      mutate(value);
      assert.throws(() => verifyAcceptanceSet(value), pattern);
    });
  }
});
