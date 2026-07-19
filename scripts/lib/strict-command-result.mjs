/**
 * U007 — strict command/test result parser.
 * Non-zero exit, 0 tests, No tests, skip/fixme/todo/only/flaky/retry,
 * truncated/unparseable output, missing/duplicate receipt → FAIL.
 */
import { createHash } from "node:crypto";

/** @typedef {"PASS"|"FAIL"|"UNKNOWN"} Verdict */

/**
 * @param {string} text
 * @returns {string}
 */
export function hashOutput(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

/**
 * @param {string} stdout
 * @param {string} stderr
 * @returns {{
 *   total: number|null,
 *   passed: number|null,
 *   failed: number|null,
 *   skipped: number,
 *   fixme: number,
 *   todo: number,
 *   only: number,
 *   flaky: number,
 *   retry: number,
 *   noTestsPhrase: boolean,
 *   parseable: boolean,
 * }}
 */
export function parseTestCounts(stdout = "", stderr = "") {
  const text = `${stdout}\n${stderr}`;
  const lower = text.toLowerCase();

  const noTestsPhrase =
    /\bno tests?\b/i.test(text) ||
    /no test files? found/i.test(text) ||
    /no tests found/i.test(text);

  let total = null;
  let passed = null;
  let failed = null;

  // node --test TAP / summary
  const nodeSummary = text.match(
    /#\s*tests\s+(\d+)[\s\S]*?#\s*pass\s+(\d+)[\s\S]*?#\s*fail\s+(\d+)/i,
  );
  if (nodeSummary) {
    total = Number(nodeSummary[1]);
    passed = Number(nodeSummary[2]);
    failed = Number(nodeSummary[3]);
  }

  // vitest summary: Tests  2 passed (2)
  const vitest =
    text.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed/i) ||
    text.match(/Tests\s+(\d+)\s+passed/i) ||
    text.match(/Test Files\s+\d+[^\n]*\n\s*Tests\s+(\d+)\s+passed/i);
  if (total === null && vitest) {
    if (vitest[2] !== undefined) {
      failed = Number(vitest[1]);
      passed = Number(vitest[2]);
      total = failed + passed;
    } else {
      passed = Number(vitest[1]);
      total = passed;
      failed = 0;
    }
  }

  // playwright JSON-ish / summary
  const pw = text.match(/(\d+)\s+passed/i);
  if (total === null && pw && !/0\s+passed/i.test(text) === false) {
    // keep null if only ambiguous
  }
  const pwTotal = text.match(/(\d+)\s+passed.*?(\d+)\s+failed/i);
  if (total === null && pwTotal) {
    passed = Number(pwTotal[1]);
    failed = Number(pwTotal[2]);
    total = passed + failed;
  }

  // generic "tests: N"
  const testsN = text.match(/\btests?\s*[:=]\s*(\d+)\b/i);
  if (total === null && testsN) {
    total = Number(testsN[1]);
  }

  const countRe = (re) => {
    let n = 0;
    for (const m of text.matchAll(re)) {
      if (m[1] !== undefined) n += Number(m[1]);
      else n += 1;
    }
    return n;
  };

  // Prefer numeric captures; treat explicit zero as zero (not "present").
  const skipped = Math.max(
    countRe(/\b(\d+)\s+skipped\b/gi),
    countRe(/\bskipped\s*[:=]\s*(\d+)\b/gi),
    countRe(/^#\s*skip(?:ped)?\s+(\d+)\b/gim),
  );
  const fixme = Math.max(
    countRe(/\b(\d+)\s+fixme\b/gi),
    countRe(/^#\s*fixme\s+(\d+)\b/gim),
    /\bfixme\b/i.test(text) && !/^#\s*fixme\s+0\b/im.test(text) ? 1 : 0,
  );
  const todo = Math.max(
    countRe(/\b(\d+)\s+todo\b/gi),
    countRe(/^#\s*todo\s+(\d+)\b/gim),
    /^#\s*todo\b/im.test(text) && !/^#\s*todo\s+0\b/im.test(text) ? 1 : 0,
  );
  const only = Math.max(
    countRe(/\bit\.only\b/g),
    countRe(/\bdescribe\.only\b/g),
    countRe(/\bonly\s*[:=]\s*(\d+)\b/gi),
  );
  const flaky = Math.max(
    countRe(/\b(\d+)\s+flaky\b/gi),
    countRe(/^#\s*flaky\s+(\d+)\b/gim),
    /\bflaky\b/i.test(text) && !/\b0\s+flaky\b/i.test(text) ? 1 : 0,
  );
  const retry = Math.max(
    countRe(/\b(\d+)\s+retr(?:y|ies)\b/gi),
    countRe(/\bretr(?:y|ies)\s*[:=]\s*(\d+)\b/gi),
    countRe(/^#\s*retr(?:y|ies)\s+(\d+)\b/gim),
    /\bretry\b/i.test(text) && !/\b0\s+retr/i.test(text) && !/^#\s*retr(?:y|ies)\s+0\b/im.test(text)
      ? 1
      : 0,
  );

  // Heuristic: if no structured counts and "No tests" present → total 0
  if (total === null && noTestsPhrase) {
    total = 0;
    passed = 0;
    failed = 0;
  }

  const parseable =
    total !== null ||
    noTestsPhrase ||
    skipped > 0 ||
    fixme > 0 ||
    todo > 0 ||
    only > 0 ||
    flaky > 0 ||
    retry > 0;

  return {
    total,
    passed,
    failed,
    skipped: Number(skipped) || 0,
    fixme: Number(fixme) || 0,
    todo: Number(todo) || 0,
    only: Number(only) || 0,
    flaky: Number(flaky) || 0,
    retry: Number(retry) || 0,
    noTestsPhrase,
    parseable,
  };
}

/**
 * @param {{
 *   exitCode: number|null|undefined,
 *   stdout?: string,
 *   stderr?: string,
 *   policy: "command"|"strict-test",
 *   receiptPresent?: boolean,
 *   receiptDuplicate?: boolean,
 *   truncated?: boolean,
 * }} input
 * @returns {{
 *   verdict: Verdict,
 *   reason: string,
 *   exitCode: number|null,
 *   counts: ReturnType<typeof parseTestCounts>,
 *   outputHash: string,
 * }}
 */
export function evaluateCommandResult(input) {
  const {
    exitCode,
    stdout = "",
    stderr = "",
    policy,
    receiptPresent = true,
    receiptDuplicate = false,
    truncated = false,
  } = input;

  const counts = parseTestCounts(stdout, stderr);
  const outputHash = hashOutput(`${stdout}\n${stderr}`);
  const code = exitCode === undefined || exitCode === null ? null : Number(exitCode);

  if (receiptDuplicate) {
    return {
      verdict: "FAIL",
      reason: "duplicate_receipt",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (!receiptPresent) {
    return {
      verdict: "FAIL",
      reason: "missing_receipt",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (truncated) {
    return {
      verdict: "FAIL",
      reason: "truncated_output",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (code === null || Number.isNaN(code)) {
    return {
      verdict: "UNKNOWN",
      reason: "missing_exit_code",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (code !== 0) {
    // last-line "passed" with non-zero is still FAIL
    return {
      verdict: "FAIL",
      reason: "nonzero_exit",
      exitCode: code,
      counts,
      outputHash,
    };
  }

  if (policy === "command") {
    return {
      verdict: "PASS",
      reason: "command_exit_0",
      exitCode: code,
      counts,
      outputHash,
    };
  }

  // strict-test
  if (!counts.parseable && counts.total === null) {
    return {
      verdict: "FAIL",
      reason: "unparseable_output",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.noTestsPhrase || counts.total === 0) {
    return {
      verdict: "FAIL",
      reason: "zero_tests",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.total === null) {
    return {
      verdict: "FAIL",
      reason: "missing_test_count",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.skipped > 0) {
    return {
      verdict: "FAIL",
      reason: "skipped_tests",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.fixme > 0) {
    return {
      verdict: "FAIL",
      reason: "fixme_tests",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.todo > 0) {
    return {
      verdict: "FAIL",
      reason: "todo_tests",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.only > 0) {
    return {
      verdict: "FAIL",
      reason: "only_annotation",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.flaky > 0) {
    return {
      verdict: "FAIL",
      reason: "flaky_tests",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.retry > 0) {
    return {
      verdict: "FAIL",
      reason: "retry_present",
      exitCode: code,
      counts,
      outputHash,
    };
  }
  if (counts.failed !== null && counts.failed > 0) {
    return {
      verdict: "FAIL",
      reason: "failed_tests",
      exitCode: code,
      counts,
      outputHash,
    };
  }

  return {
    verdict: "PASS",
    reason: "strict_test_pass",
    exitCode: code,
    counts,
    outputHash,
  };
}

/**
 * Convenience for fixture tests: evaluate sample stdout/stderr/exit.
 */
export function evaluateSample({
  exitCode,
  stdout = "",
  stderr = "",
  policy = "strict-test",
  receiptPresent = true,
}) {
  return evaluateCommandResult({
    exitCode,
    stdout,
    stderr,
    policy,
    receiptPresent,
  });
}
