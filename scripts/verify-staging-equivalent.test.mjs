import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyStagingEquivalentSet } from "./verify-staging-equivalent.mjs";

const SHA = "c".repeat(40);

function fixture() {
  return {
    candidateSha: SHA,
    runId: "U076-final-test",
    phaseA: {
      candidateSha: SHA,
      runId: "U076-final-test",
      ownerUnit: "U076",
      webPort: 43101,
      apiPort: 43201,
      health: { web: 200, api: 200 },
      cleanup: { result: "PASS", processes: 0, portsFree: true },
    },
    phaseB: {
      candidateSha: SHA,
      runId: "U076-final-test",
      ownerUnit: "U076",
      webPort: 43101,
      apiPort: 43201,
      playwright: {
        exitCode: 0,
        totalTests: 30,
        skipped: 0,
        retries: 0,
        workers: 1,
        reuseExistingServer: false,
      },
      surface: {
        widths: [375, 768, 1280],
        axeViolations: 0,
        keyboardFailures: 0,
        consoleErrors: 0,
        networkErrors: 0,
      },
      cleanup: { result: "PASS", processes: 0, portsFree: true, databases: 0 },
    },
  };
}

describe("U076 staging-equivalent verifier", () => {
  it("accepts ordered phase A then fresh phase B", () => {
    assert.equal(verifyStagingEquivalentSet(fixture()).result, "PASS");
  });

  for (const [name, mutate, pattern] of [
    ["stale SHA", (value) => { value.phaseB.candidateSha = "d".repeat(40); }, /candidate SHA/i],
    ["phase A listener leak", (value) => { value.phaseA.cleanup.portsFree = false; }, /phase A cleanup/i],
    ["reused server", (value) => { value.phaseB.playwright.reuseExistingServer = true; }, /fresh server/i],
    ["viewport drift", (value) => { value.phaseB.surface.widths = [375, 1280]; }, /widths/i],
    ["accessibility failure", (value) => { value.phaseB.surface.axeViolations = 1; }, /surface/i],
    ["cleanup failure", (value) => { value.phaseB.cleanup.databases = 1; }, /phase B cleanup/i],
  ]) {
    it(`rejects ${name}`, () => {
      const value = fixture();
      mutate(value);
      assert.throws(() => verifyStagingEquivalentSet(value), pattern);
    });
  }
});
