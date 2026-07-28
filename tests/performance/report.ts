/**
 * U075 — Performance Report Generator
 */

import type { SampleResult } from "./measure";
import { evaluateAllContracts } from "./contracts";

export type PerfReport = {
  runId: string;
  timestamp: string;
  hardware: string;
  runtime: string;
  contracts: Record<string, { passed: boolean; violations: string[] }>;
  samples: Record<string, SampleResult>;
  overallPassed: boolean;
};

export function generateReport(
  runId: string,
  samples: Record<string, SampleResult>,
): PerfReport {
  const measured: Record<string, { p95: number; p99: number }> = {};
  for (const [name, s] of Object.entries(samples)) {
    measured[name] = { p95: s.p95, p99: s.p99 };
  }

  const { passed, report } = evaluateAllContracts(measured);

  return {
    runId,
    timestamp: new Date().toISOString(),
    hardware: `${process.arch}-${process.platform}`,
    runtime: `node-${process.version}`,
    contracts: report,
    samples,
    overallPassed: passed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const inputFile = process.env.PERF_RESULTS_FILE;
  const browserFile = process.env.PERF_BROWSER_RESULTS_FILE;
  const reportFile = process.env.PERF_REPORT_FILE;
  const runId = process.env.TASK_RUN_ID;
  if (!inputFile || !browserFile || !reportFile || !runId) {
    throw new Error("PERF_RESULTS_FILE, PERF_BROWSER_RESULTS_FILE, PERF_REPORT_FILE and TASK_RUN_ID are required");
  }
  const phaseA = JSON.parse(readFileSync(inputFile, "utf8")) as Record<string, SampleResult>;
  const browser = JSON.parse(readFileSync(browserFile, "utf8")) as Record<string, SampleResult>;
  const report = generateReport(runId, { ...phaseA, ...browser });
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ overallPassed: report.overallPassed, reportFile })}\n`);
  if (!report.overallPassed) process.exitCode = 1;
}
