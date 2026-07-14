import { describe, expect, it } from "vitest";

import {
  calculateSalesDashboard,
  calculatePresalesDashboard,
  calculateFinanceDashboard,
  calculateSupportDashboard,
  calculateOperatorDashboard,
  calculateSecurityDashboard,
  LARGE_DEAL_RISK_THRESHOLD,
} from "./role-dashboard";

describe("calculateSalesDashboard", () => {
  it("returns the correct shape and values for a representative input", () => {
    const result = calculateSalesDashboard({
      opportunities: [
        { id: "opp-1", stage: "LEAD", amount: 10000, customer: { name: "Acme Corp" } },
        { id: "opp-2", stage: "discovery", amount: 25000, customer: null },
        { id: "opp-3", stage: "NEGOTIATION", amount: 60000, customer: { name: "MegaCorp" } },
        { id: "opp-4", stage: "NEGOTIATION", amount: 30000, customer: { name: "SmallBiz" } },
        { id: "opp-5", stage: "WON", amount: null, customer: null },
      ],
      pendingApprovals: [{ id: "apr-1" }, { id: "apr-2" }],
      proposals: [
        { status: "draft" },
        { status: "draft" },
        { status: "submitted" },
      ],
    });

    expect(result).toEqual({
      pipeline: [
        { id: "opp-1", customer: "Acme Corp", stage: "LEAD", value: 10000 },
        { id: "opp-2", customer: null, stage: "discovery", value: 25000 },
        { id: "opp-3", customer: "MegaCorp", stage: "NEGOTIATION", value: 60000 },
        { id: "opp-4", customer: "SmallBiz", stage: "NEGOTIATION", value: 30000 },
      ],
      followUp: 2,
      pendingApprovals: 2,
      proposalsInProgress: 2,
      renewalsDue: 0,
      riskDeals: 1,
    });
  });

  it("uses ?? null for missing customer name (defensive)", () => {
    const result = calculateSalesDashboard({
      opportunities: [
        { id: "o1", stage: "LEAD", amount: null, customer: undefined },
      ],
      pendingApprovals: [],
      proposals: [],
    });

    expect(result.pipeline[0].customer).toBeNull();
  });

  it("respects LARGE_DEAL_RISK_THRESHOLD", () => {
    expect(LARGE_DEAL_RISK_THRESHOLD).toBe(50000);

    const atThreshold = calculateSalesDashboard({
      opportunities: [
        { id: "o1", stage: "NEGOTIATION", amount: 50000, customer: null },
        { id: "o2", stage: "NEGOTIATION", amount: 50001, customer: null },
      ],
      pendingApprovals: [],
      proposals: [],
    });

    expect(atThreshold.riskDeals).toBe(1);
  });
});

describe("calculatePresalesDashboard", () => {
  it("returns the correct shape and values", () => {
    const result = calculatePresalesDashboard({
      pocProjects: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    });

    expect(result).toEqual({
      pendingDiscovery: 0,
      solutionFitReview: 0,
      missingSizing: 0,
      pocPrep: 3,
      aiDraftReview: 0,
    });
  });

  it("returns pocPrep = 0 for empty pocProjects", () => {
    const result = calculatePresalesDashboard({ pocProjects: [] });
    expect(result.pocPrep).toBe(0);
  });
});

describe("calculateFinanceDashboard", () => {
  it("returns the correct shape and values", () => {
    const result = calculateFinanceDashboard({
      approvals: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }],
    });

    expect(result).toEqual({
      commercialApprovalQueue: 4,
      lowMarginDeals: 0,
      highDiscountRequests: 0,
      quoteDiffs: 0,
      exceptionPayments: 0,
    });
  });
});

describe("calculateSupportDashboard", () => {
  it("returns the correct shape and values", () => {
    const result = calculateSupportDashboard({
      cases: [
        { status: "open" },
        { status: "open" },
        { status: "closed" },
        { status: "open" },
      ],
    });

    expect(result).toEqual({
      newTickets: 3,
      slaDeadlines: 0,
      vendorEscalations: 0,
      rcaRequired: 0,
      repeatIssues: 0,
    });
  });
});

describe("calculateOperatorDashboard", () => {
  it("returns the correct static shape", () => {
    const result = calculateOperatorDashboard();

    expect(result).toEqual({
      systemHealth: { api: "ok", web: "ok", finance: "unreachable", postgres: "ok", redis: "ok" },
      workflowQueue: 0,
      aiUsage: { todayTokens: 0, todayCost: 0, providerCalls: 0 },
      toolLogs: [],
      failedJobs: 0,
      rlsPolicyCheck: "active",
      auditIntegrity: "verified",
      backupStatus: "ok",
      tenantHealth: { total: 1, healthy: 1 },
    });
  });
});

describe("calculateSecurityDashboard", () => {
  it("returns the correct static shape", () => {
    const result = calculateSecurityDashboard();

    expect(result).toEqual({
      restrictedDataAccess: [],
      roleChanges: 0,
      privilegedAccess: 0,
      auditMismatch: false,
      aiPolicyViolations: 0,
      exportEvents: [],
      workflowChanges: 0,
    });
  });
});
