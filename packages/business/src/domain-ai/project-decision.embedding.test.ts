import { describe, it, expect, vi, beforeEach } from "vitest";

import { createHashEmbedder } from "./domain-embedder";

/**
 * recordHumanDecision 쓰기 경로의 best-effort 임베딩 계약 (DB 불필요).
 * 임베더가 살아있으면 벡터를 저장하고, 죽으면 임베딩만 생략한 채 학습 쓰기는 계속된다.
 */
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(async () => null),
  update: vi.fn(async () => ({})),
  recordDomainDecision: vi.fn(async () => ({ id: "decision-1" })),
  upsertDomainMemory: vi.fn(async (_input: Record<string, unknown>) => ({}) as never),
}));

vi.mock("@sangfor/db", () => ({
  Prisma: {},
  prisma: { domainDecisionLog: { findFirst: mocks.findFirst, update: mocks.update } },
}));

vi.mock("./domain-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domain-memory")>();
  return {
    ...actual,
    recordDomainDecision: mocks.recordDomainDecision,
    upsertDomainMemory: mocks.upsertDomainMemory,
  };
});

vi.mock("./proposal-promote", () => ({
  promoteDomainProposalToDocument: vi.fn(async () => null),
}));

const { recordHumanDecision } = await import("./project-decision");

const input = {
  engagementId: "e-embed",
  domain: "sales" as const,
  outcome: "approved" as const,
  output: { summary: "no promotable body" },
  note: "human approved",
};

function upsertArg() {
  return mocks.upsertDomainMemory.mock.calls[0]![0];
}

describe("recordHumanDecision — best-effort embedding write path", () => {
  beforeEach(() => {
    mocks.upsertDomainMemory.mockClear();
    mocks.recordDomainDecision.mockClear();
  });

  it("stores the resolved embedding with the human-source memory", async () => {
    const result = await recordHumanDecision(input, { embed: createHashEmbedder(64) });

    expect(result.decisionId).toBe("decision-1");
    expect(mocks.upsertDomainMemory).toHaveBeenCalledTimes(1);
    const arg = upsertArg();
    expect(arg.source).toBe("human");
    expect(arg.key).toBe("eng:e-embed:sales");
    expect(arg.embedding).toHaveLength(64);
  });

  it("omits the embedding but still writes the memory when the embedder fails", async () => {
    const failing = async (): Promise<number[]> => {
      throw new Error("embedder down");
    };

    const result = await recordHumanDecision(input, { embed: failing });

    expect(result.decisionId).toBe("decision-1");
    expect(mocks.upsertDomainMemory).toHaveBeenCalledTimes(1);
    const arg = upsertArg();
    expect(arg).not.toHaveProperty("embedding");
    // 학습 쓰기 자체는 임베딩 실패와 무관하게 온전히 수행된다
    expect(arg.tags).toEqual(["domain:sales", "entity:proposal", "intent:approved"]);
    expect(arg.confidence).toBe(90);
  });

  it("omits the embedding when the embedder returns an empty vector", async () => {
    await recordHumanDecision(input, { embed: async () => [] });

    expect(upsertArg()).not.toHaveProperty("embedding");
  });

  it("skips the learning write entirely for a rejected decision", async () => {
    await recordHumanDecision(
      { ...input, outcome: "rejected" as const },
      { embed: createHashEmbedder(64) },
    );

    expect(mocks.upsertDomainMemory).not.toHaveBeenCalled();
  });
});
