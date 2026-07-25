/**
 * U075 — Performance Contracts
 *
 * Numeric DB/API/kernel/browser performance gates.
 * Run via: pnpm perf:contracts
 */

export type PerfContract = {
  name: string;
  metric: string;
  p95: number;
  p99: number;
  unit: "ms" | "bytes" | "count";
  blocking: boolean;
};

export const PERF_CONTRACTS: PerfContract[] = [
  { name: "quote-kernel", metric: "quote_calculation_latency", p95: 5, p99: 10, unit: "ms", blocking: true },
  { name: "quote-http", metric: "quote_http_latency", p95: 300, p99: 500, unit: "ms", blocking: true },
  { name: "list-db", metric: "canonical_list_db_latency", p95: 50, p99: 100, unit: "ms", blocking: true },
  { name: "list-api", metric: "canonical_list_api_latency", p95: 250, p99: 400, unit: "ms", blocking: true },
  { name: "roi-dashboard", metric: "roi_dashboard_latency", p95: 300, p99: 500, unit: "ms", blocking: true },
  { name: "roi-payload", metric: "roi_dashboard_payload", p95: 262144, p99: 262144, unit: "bytes", blocking: true },
  { name: "workflow-concurrency", metric: "workflow_start_total", p95: 2000, p99: 3000, unit: "ms", blocking: true },
  { name: "workflow-individual", metric: "workflow_start_individual", p95: 500, p99: 800, unit: "ms", blocking: true },
  { name: "browser-ready", metric: "initial_ready", p95: 2500, p99: 3500, unit: "ms", blocking: true },
  { name: "browser-transition", metric: "page_transition", p95: 750, p99: 1200, unit: "ms", blocking: true },
  { name: "dom-nodes", metric: "collection_record_nodes", p95: 50, p99: 50, unit: "count", blocking: true },
];

export function evaluateContract(contract: PerfContract, measured: { p95: number; p99: number }): { passed: boolean; violations: string[] } {
  const violations: string[] = [];
  if (measured.p95 > contract.p95) violations.push(`p95 ${measured.p95}${contract.unit} > ${contract.p95}${contract.unit}`);
  if (measured.p99 > contract.p99) violations.push(`p99 ${measured.p99}${contract.unit} > ${contract.p99}${contract.unit}`);
  return { passed: violations.length === 0, violations };
}

export function evaluateAllContracts(results: Record<string, { p95: number; p99: number }>): { passed: boolean; report: Record<string, { passed: boolean; violations: string[] }> } {
  const report: Record<string, { passed: boolean; violations: string[] }> = {};
  let allPassed = true;
  for (const contract of PERF_CONTRACTS) {
    const measured = results[contract.name];
    if (!measured) {
      report[contract.name] = { passed: false, violations: ["no measurement"] };
      allPassed = false;
      continue;
    }
    const result = evaluateContract(contract, measured);
    report[contract.name] = result;
    if (!result.passed && contract.blocking) allPassed = false;
  }
  return { passed: allPassed, report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("[U075] Performance contracts defined:");
  for (const c of PERF_CONTRACTS) {
    console.log(`  ${c.name}: p95<=${c.p95}${c.unit} p99<=${c.p99}${c.unit} ${c.blocking ? "BLOCKING" : "nonblocking"}`);
  }
}
