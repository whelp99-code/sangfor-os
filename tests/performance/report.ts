/**
 * U075 — Performance Report Generator
 */

import type { SampleResult } from "./measure";
import { PERF_CONTRACTS, evaluateAllContracts } from "./contracts";

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
