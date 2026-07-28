import { describe, expect, it } from "vitest";
import {
  evaluateAllContracts,
  PERF_CONTRACTS,
  QUOTE_HTTP_OPPORTUNITY_COUNT,
} from "./contracts";
import { PERFORMANCE_ROUTES, PERFORMANCE_VIEWPORTS } from "./browser-contract";

describe("U075 performance contract evaluation", () => {
  it("fails when measurements are absent", () => {
    const result = evaluateAllContracts({});
    expect(result.passed).toBe(false);
    expect(Object.keys(result.report)).toHaveLength(PERF_CONTRACTS.length);
    expect(Object.values(result.report).every((entry) => !entry.passed)).toBe(true);
  });

  it("passes only when every blocking measurement is within budget", () => {
    const measurements = Object.fromEntries(
      PERF_CONTRACTS.map((contract) => [contract.name, { p95: contract.p95, p99: contract.p99 }]),
    );
    expect(evaluateAllContracts(measurements).passed).toBe(true);

    measurements[PERF_CONTRACTS[0]!.name] = { p95: PERF_CONTRACTS[0]!.p95 + 1, p99: PERF_CONTRACTS[0]!.p99 };
    expect(evaluateAllContracts(measurements).passed).toBe(false);
  });

  it("covers the canonical six routes at three viewports", () => {
    expect(PERFORMANCE_ROUTES).toEqual(["/deals", "/approvals", "/registry/products", "/support", "/dashboard", "/dashboard/roi"]);
    expect(PERFORMANCE_VIEWPORTS).toHaveLength(3);
    expect(PERFORMANCE_ROUTES.length * PERFORMANCE_VIEWPORTS.length).toBe(18);
  });

  it("reserves twenty-five qualified opportunities for quote warmup and samples", () => {
    const measuredOpportunityIds = Array.from(
      { length: QUOTE_HTTP_OPPORTUNITY_COUNT },
      (_, index) => `u075-opportunity-${String(index + 1).padStart(4, "0")}`,
    );
    expect(new Set(measuredOpportunityIds)).toHaveLength(QUOTE_HTTP_OPPORTUNITY_COUNT);
    expect(measuredOpportunityIds.at(-1)).toBe("u075-opportunity-0025");
  });
});
