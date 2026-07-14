import { beforeEach, describe, expect, it, vi } from "vitest";

type CandidateState = {
  id: string;
  candidateType: string;
  title: string;
  summary: string;
  status: string;
  confidence: number;
  metadata: Record<string, unknown>;
  createdEntityType: string | null;
  createdEntityId: string | null;
  knowledgeDocumentId: string | null;
  sourceSender: string | null;
};

type UpdateManyArgs = {
  readonly where: { readonly id: string; readonly status: string };
  readonly data: Partial<CandidateState>;
};

const mocks = vi.hoisted(() => {
  const state: CandidateState = {
    id: "candidate-1",
    candidateType: "customer",
    title: "Customer: Concurrent Corp",
    summary: "Concurrent approval",
    status: "proposed",
    confidence: 90,
    metadata: {},
    createdEntityType: null,
    createdEntityId: null,
    knowledgeDocumentId: null,
    sourceSender: null,
  };
  return {
    state,
    createCustomer: vi.fn(async () => ({ id: "customer-1" })),
    recordDecision: vi.fn(async () => undefined),
    updateMany: vi.fn(async (args: UpdateManyArgs) => {
      if (args.where.id !== state.id || args.where.status !== state.status) return { count: 0 };
      Object.assign(state, args.data);
      return { count: 1 };
    }),
    upsertPolicyMemory: vi.fn(async () => undefined),
  };
});

vi.mock("@sangfor/db", () => ({
  prisma: {
    customer: { findFirst: vi.fn(async () => null) },
    mailDerivedCandidate: {
      findUniqueOrThrow: vi.fn(async () => ({ ...mocks.state })),
      updateMany: mocks.updateMany,
    },
    project: {
      findMany: vi.fn(async () => [{ id: "project-1", slug: "demo-project", name: "Demo" }]),
    },
  },
}));
vi.mock("../crm/customer-partner", () => ({
  createCustomer: mocks.createCustomer,
  createPartner: vi.fn(),
}));
vi.mock("../crm/opportunity-center", () => ({ createOpportunity: vi.fn() }));
vi.mock("../crm/poc-center", () => ({ createPocProject: vi.fn() }));
vi.mock("../domain-ai/domain-memory", () => ({ upsertDomainMemory: vi.fn() }));
vi.mock("../governance/ai-decision", () => ({ recordDecision: mocks.recordDecision }));
vi.mock("../orchestration/improvement-loop", () => ({ createImprovementCandidateFromError: vi.fn() }));
vi.mock("../orchestration/task-center", () => ({
  createWorkTask: vi.fn(),
  linkTaskToEntity: vi.fn(),
}));
vi.mock("./mail-policy-memory", () => ({
  buildStaticMailPolicyLookup: vi.fn(() => ({})),
  upsertPolicyMemory: mocks.upsertPolicyMemory,
}));

import {
  approveMailDerivedCandidate,
  CandidateConversionInProgressError,
} from "./candidates-update";

beforeEach(() => {
  Object.assign(mocks.state, {
    status: "proposed",
    createdEntityType: null,
    createdEntityId: null,
  });
  vi.clearAllMocks();
});

describe("approveMailDerivedCandidate concurrency", () => {
  it("allows one of ten simultaneous approvals to convert and record a decision", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => approveMailDerivedCandidate(mocks.state.id)),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    expect(
      rejected.every((result) => result.reason instanceof CandidateConversionInProgressError),
    ).toBe(true);
    expect(mocks.createCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.recordDecision).toHaveBeenCalledTimes(1);
    expect(mocks.state.status).toBe("converted");
    expect(mocks.state.createdEntityId).toBe("customer-1");
  });

  it("restores the original status when entity conversion fails", async () => {
    mocks.createCustomer.mockRejectedValueOnce(new Error("customer_create_failed"));

    await expect(approveMailDerivedCandidate(mocks.state.id)).rejects.toThrow(
      "customer_create_failed",
    );

    expect(mocks.state.status).toBe("proposed");
    expect(mocks.recordDecision).not.toHaveBeenCalled();
  });

  it("returns an idempotent success after another caller has completed conversion", async () => {
    Object.assign(mocks.state, {
      status: "converted",
      createdEntityType: "customer",
      createdEntityId: "customer-1",
    });

    const result = await approveMailDerivedCandidate(mocks.state.id);

    expect(result.created).toBeNull();
    expect(result.candidate.createdEntityId).toBe("customer-1");
    expect(mocks.createCustomer).not.toHaveBeenCalled();
    expect(mocks.recordDecision).not.toHaveBeenCalled();
  });
});
