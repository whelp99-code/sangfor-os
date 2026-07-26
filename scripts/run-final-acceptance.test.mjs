import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runFinalAcceptanceCore, validateFinalMirrorInvocation } from "./run-final-acceptance.mjs";

const SHA = "e".repeat(40);
const HASH = "f".repeat(64);

function contracts() {
  const manifestRows = Array.from({ length: 98 }, (_, index) => ({
    id: `AUTO-${String(index + 1).padStart(3, "0")}`,
    verificationState: "AUTONOMOUS_LOCAL",
    primaryTest: `T-${String((index % 22) + 1).padStart(2, "0")}`,
  }));
  manifestRows.push({ id: "AC-DOD-09", verificationState: "MANUAL_EXTERNAL_PENDING", primaryTest: "T-REL" });
  const aliases = Array.from({ length: 22 }, (_, index) => ({
    alias: `T-${String(index + 1).padStart(2, "0")}`,
    owner: `OWN-${String(index + 1).padStart(2, "0")}`,
    executionOwnerUnit: `U${String(index + 1).padStart(3, "0")}`,
    manifestRowIds: manifestRows.filter((row) => row.primaryTest === `T-${String(index + 1).padStart(2, "0")}`).map((row) => row.id),
  }));
  aliases.push({ alias: "T-REL", owner: "REL-01", executionOwnerUnit: "U076", manifestRowIds: ["AC-DOD-09"] });
  return { manifestRows, aliases };
}

function invocation() {
  return {
    context: {
      schemaVersion: 1,
      mode: "u076-final-aliases",
      runId: "U076-final-test",
      ownerUnit: "U076",
      candidateSha: SHA,
      mirrorPath: "/tmp/u076/source",
      mirrorHead: SHA,
      detached: true,
      sourceStatus: "clean",
      envCheckpointHash: HASH,
      childEnvKeySetHash: HASH,
      receiptSchemaHash: HASH,
      createdAt: "2026-07-26T00:00:00.000Z",
    },
    contextFile: "/tmp/u076/detached-release-mirror-context.json",
    contextHash: HASH,
    cwd: "/tmp/u076/source",
    scriptPath: "/tmp/u076/source/scripts/run-final-acceptance.mjs",
    headSha: SHA,
    status: "",
    envFiles: [],
  };
}

function manualReceipt() {
  return {
    schemaVersion: 1,
    manifestId: "AC-DOD-09",
    candidateSha: SHA,
    runId: "U076-final-test",
    ownerUnit: "U076",
    verificationState: "MANUAL_EXTERNAL_PENDING",
    approvalRequired: true,
    executed: false,
    result: "PENDING",
    reason: "Owner-controlled external staging was not executed.",
    issuedAt: "2026-07-26T00:00:00.000Z",
  };
}

function aliasReceipt(entry) {
  return {
    schemaVersion: 1,
    alias: entry.alias,
    owner: entry.owner,
    executionOwnerUnit: entry.executionOwnerUnit,
    candidateSha: SHA,
    runId: "U076-final-test",
    manifestRowIds: entry.manifestRowIds.filter((id) => id !== "AC-DOD-09"),
    stepResultHashes: [{ id: "step", sha256: "1".repeat(64) }],
    artifactHashes: [{ path: "steps/step/result.json", sha256: "2".repeat(64), bytes: 1 }],
    testCount: 1,
    skipped: 0,
    result: "PASS",
    databaseProvisioned: false,
    cleanup: { result: "PASS", resources: 0 },
    createdAt: "2026-07-26T00:00:00.000Z",
  };
}

describe("U076 final acceptance orchestration", () => {
  it("rejects direct product-worktree or stale mirror invocation", () => {
    assert.throws(() => validateFinalMirrorInvocation({ ...invocation(), cwd: "/repo" }), /detached mirror/i);
    const stale = invocation();
    stale.headSha = "a".repeat(40);
    assert.throws(() => validateFinalMirrorInvocation(stale), /candidate SHA/i);
  });

  it("runs staging, pending receipt, 23 aliases, then strict aggregation", async () => {
    const { manifestRows, aliases } = contracts();
    const order = [];
    const result = await runFinalAcceptanceCore({
      candidateSha: SHA,
      runId: "U076-final-test",
      manifestRows,
      aliasEntries: aliases,
      runStaging: async () => { order.push("staging"); return { result: "PASS" }; },
      writeManualPending: async () => { order.push("manual"); return manualReceipt(); },
      runAlias: async (entry) => {
        order.push(entry.alias);
        return aliasReceipt(entry);
      },
    });
    assert.deepEqual(order.slice(0, 2), ["staging", "manual"]);
    assert.equal(order.length, 25);
    assert.equal(result.state, "LOCAL_PASS_EXTERNAL_PENDING");
  });

  it("stops before later aliases after the first failure", async () => {
    const { manifestRows, aliases } = contracts();
    let calls = 0;
    await assert.rejects(() => runFinalAcceptanceCore({
      candidateSha: SHA,
      runId: "U076-final-test",
      manifestRows,
      aliasEntries: aliases,
      runStaging: async () => ({ result: "PASS" }),
      writeManualPending: async () => manualReceipt(),
      runAlias: async () => { calls += 1; throw new Error("alias failed"); },
    }), /alias failed/);
    assert.equal(calls, 1);
  });
});
