import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
  requireCurrentAiReleaseEvaluation: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

vi.mock("../governance/ai-release-evaluation-service", () => ({
  requireCurrentAiReleaseEvaluation: mocks.requireCurrentAiReleaseEvaluation,
}));

import {
  startDealWorkflowRun,
  evaluateDealWorkflowGates,
  DealWorkflowError,
} from "./deal-workflow";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "sales_manager", permissions: [], product: "portal",
};

describe("U050: deal-workflow service unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing opportunityId or idempotencyKey", async () => {
    await expect(startDealWorkflowRun({
      authContext: CTX, opportunityId: "", idempotencyKey: "k1",
    })).rejects.toThrow("opportunityId and idempotencyKey required");
  });

  it("rejects when qualification score is missing", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        opportunity: { findUniqueOrThrow: vi.fn(async () => ({ id: "opp1", stage: "PROPOSAL" })) },
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1" })) },
        dealQualification: { findFirst: vi.fn(async () => null) },
      };
      return cb(tx);
    });

    await expect(startDealWorkflowRun({
      authContext: CTX, opportunityId: "opp1", idempotencyKey: "k1",
    })).rejects.toThrow("qualification (bant-tf-v1) is required");
  });

  it("starts workflow run and checks ordered gates including PoC requirement check", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        opportunity: { findUniqueOrThrow: vi.fn(async () => ({ id: "opp1", stage: "PROPOSAL" })) },
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1" })) },
        dealQualification: { findFirst: vi.fn(async () => ({ id: "qual1", status: "qualified" })) },
        commandRun: {
          findFirst: vi.fn(async () => null),
          create: vi.fn(async () => ({ id: "run1" })),
        },
        dealRegistration: { findFirst: vi.fn(async () => ({ id: "reg1", status: "approved" })) },
        pocProject: { findFirst: vi.fn(async () => ({ id: "poc1" })) },
        pocRequirement: { count: vi.fn(async () => 3) },
        quote: { findFirst: vi.fn(async () => ({ id: "q1", version: 1, artifactVersionId: "av1", contentHash: "h1" })) },
      };
      return cb(tx);
    });

    mocks.requireCurrentAiReleaseEvaluation.mockResolvedValue({
      evaluationId: "eval1", eligible: true, blockers: [],
    });

    const res = await startDealWorkflowRun({
      authContext: CTX,
      opportunityId: "opp1",
      idempotencyKey: "k-wf-1",
    });

    expect(res.runId).toBe("run1");
    expect(res.definitionKey).toBe("deal-execution.v1");

    const qualGate = res.gates.find((g) => g.gateKey === "qualification");
    expect(qualGate?.eligible).toBe(true);

    const pocGate = res.gates.find((g) => g.gateKey === "poc_requirements");
    expect(pocGate?.eligible).toBe(true);

    const relGate = res.gates.find((g) => g.gateKey === "commercial_release");
    expect(relGate?.eligible).toBe(true);
  });
});
