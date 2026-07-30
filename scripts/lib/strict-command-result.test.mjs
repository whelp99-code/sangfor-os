import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCommandResult,
  evaluateSample,
  parseTestCounts,
  stripAnsi,
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

  // A colorizing TERM reaches mirror children through the env allowlist, so the
  // same run must parse identically whether or not the runner emitted color.
  const COLOURED_VITEST =
    "\u001B[2m Test Files \u001B[22m \u001B[1m\u001B[32m1 passed\u001B[39m\u001B[22m\u001B[90m (1)\u001B[39m\n" +
    "\u001B[2m      Tests \u001B[22m \u001B[1m\u001B[32m5 passed\u001B[39m\u001B[22m\u001B[90m (5)\u001B[39m\n";

  it("parses a colorized vitest summary exactly like a plain one", () => {
    const coloured = parseTestCounts(COLOURED_VITEST);
    const plain = parseTestCounts(" Test Files  1 passed (1)\n      Tests  5 passed (5)\n");
    assert.deepEqual(coloured, plain);
    assert.equal(coloured.total, 5);
    assert.equal(coloured.passed, 5);
    assert.equal(coloured.failed, 0);
    assert.equal(coloured.parseable, true);
  });

  it("PASS: colorized vitest output is not unparseable_output", () => {
    const r = evaluateCommandResult({
      exitCode: 0,
      stdout: COLOURED_VITEST,
      policy: "strict-test",
    });
    assert.equal(r.verdict, "PASS");
    assert.notEqual(r.reason, "unparseable_output");
  });

  it("parses a colorized node --test summary", () => {
    const c = parseTestCounts(
      "\u001B[32m# tests 3\u001B[39m\n\u001B[32m# pass 3\u001B[39m\n\u001B[31m# fail 0\u001B[39m\n",
    );
    assert.equal(c.total, 3);
    assert.equal(c.passed, 3);
    assert.equal(c.failed, 0);
  });

  it("strips OSC title sequences and lone two-byte escapes", () => {
    assert.equal(stripAnsi("\u001B]0;window title\u0007Tests  1 passed (1)"), "Tests  1 passed (1)");
    assert.equal(stripAnsi("\u001B(BTests  1 passed (1)"), "Tests  1 passed (1)");
    assert.equal(stripAnsi("plain text"), "plain text");
  });

  it("hashes the raw bytes, not the stripped text", () => {
    const coloured = evaluateCommandResult({
      exitCode: 0,
      stdout: COLOURED_VITEST,
      policy: "strict-test",
    });
    const plain = evaluateCommandResult({
      exitCode: 0,
      stdout: " Test Files  1 passed (1)\n      Tests  5 passed (5)\n",
      policy: "strict-test",
    });
    assert.deepEqual(coloured.counts, plain.counts);
    assert.notEqual(coloured.outputHash, plain.outputHash);
  });
});
