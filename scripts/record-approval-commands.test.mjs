import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APPROVAL_COMMANDS, parseTestCount, runApprovalCommands } from "./record-approval-commands.mjs";

describe("parseTestCount", () => {
  it("reads the pass total from a clean node:test summary", () => {
    assert.equal(parseTestCount("# tests 12\n# pass 12\n# fail 0\n"), 12);
  });

  it("treats any failure as proving nothing, however many passed alongside it", () => {
    // An approval must not be buildable from a run that had failures in it.
    assert.equal(parseTestCount("# tests 12\n# pass 11\n# fail 1\n"), null);
  });

  it("treats a run with no tests as proving nothing", () => {
    assert.equal(parseTestCount("# tests 0\n# pass 0\n# fail 0\n"), null);
  });

  it("refuses output it cannot parse rather than assuming success", () => {
    for (const output of ["", "all good!", "# pass 3", "# fail 0", "ok 1 - something"]) {
      assert.equal(parseTestCount(output), null);
    }
  });
});

describe("runApprovalCommands", () => {
  it("records a successful run in the shape the signer accepts", () => {
    const results = runApprovalCommands(
      [["echo", "one"]],
      () => ({ status: 0, stdout: "# tests 4\n# pass 4\n# fail 0\n", stderr: "" }),
    );
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].argv, ["echo", "one"]);
    assert.equal(results[0].exitCode, 0);
    assert.equal(results[0].testCount, 4);
  });

  it("records a failure as a failure instead of dropping it", () => {
    const results = runApprovalCommands(
      [["echo", "bad"]],
      () => ({ status: 1, stdout: "# pass 0\n# fail 2\n", stderr: "boom" }),
    );
    assert.equal(results[0].exitCode, 1);
    assert.equal(results[0].testCount, 0);
  });

  it("reports a command that could not start as a failure, not as exit 0", () => {
    // spawnSync returns status null when the process never ran.
    const results = runApprovalCommands([["missing"]], () => ({ status: null, stdout: "", stderr: "ENOENT" }));
    assert.notEqual(results[0].exitCode, 0);
  });

  it("stands behind a staging approval with the checks that actually cover it", () => {
    const joined = APPROVAL_COMMANDS.map((argv) => argv.join(" "));
    assert.ok(joined.some((command) => command.includes("verify-staging-equivalent")));
    assert.ok(joined.some((command) => command.includes("verify-acceptance")));
    assert.ok(joined.some((command) => command.includes("verify-production-readiness")));
    for (const argv of APPROVAL_COMMANDS) assert.ok(argv.includes("--test"), "every approval command must run tests");
  });
});
