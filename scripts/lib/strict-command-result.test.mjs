import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCommandResult,
  evaluateSample,
  parseTestCounts,
} from "./strict-command-result.mjs";

describe("strict-command-result", () => {
  it("FAIL: exit 1 with last line passed", () => {
    const r = evaluateSample({
      exitCode: 1,
      stdout: "FAIL\n\npassed\n",
      policy: "strict-test",
    });
    assert.equal(r.verdict, "FAIL");
    assert.equal(r.reason, "nonzero_exit");
  });

  it("FAIL: exit 0 + 0 tests", () => {
    const r = evaluateSample({
      exitCode: 0,
      stdout: "# tests 0\n# pass 0\n# fail 0\n",
    });
    assert.equal(r.verdict, "FAIL");
    assert.equal(r.reason, "zero_tests");
  });

  it("FAIL: exit 0 + No tests phrase", () => {
    const r = evaluateSample({
      exitCode: 0,
      stdout: "No tests\n",
    });
    assert.equal(r.verdict, "FAIL");
    assert.match(r.reason, /zero_tests/);
  });

  it("FAIL: skipped / fixme / todo / only / flaky / retry", () => {
    for (const sample of [
      { stdout: "# tests 2\n# pass 1\n# fail 0\n# skip 1\n1 skipped\n", reason: "skipped_tests" },
      { stdout: "# tests 1\n# pass 1\n# fail 0\n1 fixme\n", reason: "fixme_tests" },
      { stdout: "# tests 1\n# pass 1\n# fail 0\n# todo 1\n", reason: "todo_tests" },
      { stdout: "# tests 1\n# pass 1\n# fail 0\nit.only used\n", reason: "only_annotation" },
      { stdout: "# tests 1\n# pass 1\n# fail 0\n1 flaky\n", reason: "flaky_tests" },
      { stdout: "# tests 1\n# pass 1\n# fail 0\n1 retry\n", reason: "retry_present" },
    ]) {
      const r = evaluateSample({ exitCode: 0, stdout: sample.stdout });
      assert.equal(r.verdict, "FAIL", sample.reason);
      assert.equal(r.reason, sample.reason);
    }
  });

  it("FAIL: unparseable output / missing receipt", () => {
    const u = evaluateSample({
      exitCode: 0,
      stdout: "garbled binary \x00\x01",
    });
    assert.equal(u.verdict, "FAIL");
    assert.equal(u.reason, "unparseable_output");

    const m = evaluateCommandResult({
      exitCode: 0,
      stdout: "# tests 1\n# pass 1\n# fail 0\n",
      policy: "strict-test",
      receiptPresent: false,
    });
    assert.equal(m.verdict, "FAIL");
    assert.equal(m.reason, "missing_receipt");
  });

  it("FAIL: continue-on-error sample is still non-zero primary", () => {
    // Simulated: workflow build failed but outer shell continued
    const r = evaluateSample({
      exitCode: 1,
      stdout: "build failed\ncontinue-on-error: true\n",
      policy: "command",
    });
    assert.equal(r.verdict, "FAIL");
  });

  it("PASS: nonzero test count, no skips, exit 0", () => {
    const r = evaluateSample({
      exitCode: 0,
      stdout: "# tests 3\n# pass 3\n# fail 0\n# skip 0\n",
    });
    assert.equal(r.verdict, "PASS");
    assert.equal(r.counts.total, 3);
  });

  it("command policy does not invent test counts", () => {
    const r = evaluateSample({
      exitCode: 0,
      stdout: "built ok\n",
      policy: "command",
    });
    assert.equal(r.verdict, "PASS");
    assert.equal(r.reason, "command_exit_0");
  });

  it("parseTestCounts detects vitest style", () => {
    const c = parseTestCounts("Tests  2 passed (2)\n");
    assert.equal(c.total, 2);
    assert.equal(c.passed, 2);
  });

  it("ignores no-test phrases inside test names when TAP proves positive totals", () => {
    const r = evaluateSample({
      exitCode: 0,
      stdout: "# Subtest: FAIL: exit 0 + 0 tests\n# Subtest: FAIL: No tests phrase\n# Subtest: rejects fixme / flaky / retry fixtures\n# tests 3\n# pass 3\n# fail 0\n",
    });
    assert.equal(r.verdict, "PASS");
    assert.equal(r.counts.total, 3);
    assert.equal(r.counts.noTestsPhrase, false);
    assert.equal(r.counts.fixme, 0);
    assert.equal(r.counts.flaky, 0);
    assert.equal(r.counts.retry, 0);
  });
});
