import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  cosineSimilarity,
  hybridScore,
  recallHybrid,
  recallSemanticFromDb,
  getEmbedderHealth,
  resetEmbedderHealth,
  safeEmbed,
} from "./domain-embedding";
import type { DomainMemoryRecord, RecallQuery } from "./domain-memory";

// DB 로드 레이어만 모킹 — 스코어/recall 은 실제 순수 함수로 검증한다.
vi.mock("./domain-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domain-memory")>();
  return { ...actual, loadDomainMemories: vi.fn(async () => [] as DomainMemoryRecord[]) };
});

beforeEach(() => {
  resetEmbedderHealth();
});

function rec(overrides: Partial<DomainMemoryRecord>): DomainMemoryRecord {
  return {
    domain: "sales",
    memoryType: "case",
    key: "k",
    label: "l",
    tags: [],
    outcome: "approved",
    confidence: 100,
    status: "active",
    ...overrides,
  };
}

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("is 0 for mismatched / empty lengths", () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe("hybridScore", () => {
  const query: RecallQuery = { domain: "sales", tags: ["firewall"] };

  it("falls back to tag score when no embedding present", () => {
    const s = hybridScore(query, null, rec({ tags: ["firewall"] }));
    expect(s).toBeGreaterThan(0);
  });

  it("recalls on semantic similarity even with zero tag overlap", () => {
    const record = rec({ tags: ["unrelated"], embedding: [1, 0, 0] });
    const s = hybridScore(query, [1, 0, 0], record);
    expect(s).toBeGreaterThan(0); // tag overlap is 0, but embedding matches
  });

  it("enforces domain isolation in the embedding path", () => {
    const record = rec({ domain: "cfo", tags: ["firewall"], embedding: [1, 0, 0] });
    expect(hybridScore(query, [1, 0, 0], record)).toBe(0);
  });

  it("enforces active status in the embedding path", () => {
    const record = rec({ tags: ["firewall"], status: "archived", embedding: [1, 0, 0] });
    expect(hybridScore(query, [1, 0, 0], record)).toBe(0);
  });

  it("weights embedding similarity per option", () => {
    const near = rec({ tags: [], embedding: [1, 0] });
    const far = rec({ tags: [], embedding: [0, 1] });
    const sNear = hybridScore(query, [1, 0], near, { embeddingWeight: 1 });
    const sFar = hybridScore(query, [1, 0], far, { embeddingWeight: 1 });
    expect(sNear).toBeGreaterThan(sFar);
  });

  it("suppresses rejected memories even on a perfect embedding match", () => {
    const rejected = rec({ tags: ["firewall"], outcome: "rejected", embedding: [1, 0, 0] });
    expect(hybridScore(query, [1, 0, 0], rejected, { embeddingWeight: 1 })).toBe(0);
  });

  it("suppresses human-reverted memories in the embedding path", () => {
    const reverted = rec({ tags: [], outcome: "human-reverted", embedding: [1, 0, 0] });
    expect(hybridScore(query, [1, 0, 0], reverted, { embeddingWeight: 1 })).toBe(0);
  });
  it("keeps the full tag score when query/record embedding dims differ (mixed embedders)", () => {
    const tagged = rec({ tags: ["firewall"], embedding: [1, 0, 0] });
    const mixed = hybridScore(query, [1, 0], tagged);
    expect(mixed).toBe(hybridScore(query, null, tagged));
    expect(mixed).toBeGreaterThan(0);
  });
});

describe("recallHybrid", () => {
  const query: RecallQuery = { domain: "sales", tags: ["firewall"] };

  it("ranks semantically closest first, capped at topK", () => {
    const candidates: DomainMemoryRecord[] = [
      rec({ key: "far", tags: [], embedding: [0, 1] }),
      rec({ key: "near", tags: [], embedding: [1, 0] }),
      rec({ key: "other", domain: "cfo", tags: [], embedding: [1, 0] }),
    ];
    const out = recallHybrid(query, [1, 0], candidates, 1, { embeddingWeight: 1 });
    expect(out.map((r) => r.key)).toEqual(["near"]);
  });

  it("cross-suppresses a key that has any negative-outcome sibling", () => {
    const candidates: DomainMemoryRecord[] = [
      rec({ key: "deal-x", tags: ["firewall"], outcome: "approved", embedding: [1, 0] }),
      rec({ key: "deal-x", tags: ["firewall"], outcome: "rejected", embedding: [1, 0] }),
      rec({ key: "deal-y", tags: ["firewall"], outcome: "approved", embedding: [1, 0] }),
    ];
    const out = recallHybrid(query, [1, 0], candidates, 5, { embeddingWeight: 1 });
    expect(out.map((r) => r.key)).toEqual(["deal-y"]);
  });
});

describe("safeEmbed", () => {
  it("returns the vector on success", async () => {
    expect(await safeEmbed(async () => [1, 2], "x")).toEqual([1, 2]);
  });

  it("returns null when the embedder throws", async () => {
    const failing = async (): Promise<number[]> => {
      throw new Error("embedder down");
    };
    expect(await safeEmbed(failing, "x")).toBeNull();
  });

  it("returns null for an empty vector", async () => {
    expect(await safeEmbed(async () => [], "x")).toBeNull();
  });

  it("retries a transient embedder failure instead of degrading on the first error", async () => {
    let calls = 0;
    const flaky = async (): Promise<number[]> => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return [3, 4];
    };
    expect(await safeEmbed(flaky, "x", { retryDelayMs: 0 })).toEqual([3, 4]);
    expect(calls).toBe(2);
    expect(getEmbedderHealth()).toMatchObject({
      consecutiveFailures: 0,
      lastFailureReason: "transient_error",
      lastFailureAt: expect.any(String),
    });
  });

  it("does not retry a permanent provider rejection and stores only a safe reason code", async () => {
    let calls = 0;
    const rejected = async (): Promise<number[]> => {
      calls += 1;
      throw new Error("openai embeddings failed: 401 Bearer secret-value");
    };

    expect(await safeEmbed(rejected, "x", { retryDelayMs: 0 })).toBeNull();
    expect(calls).toBe(1);
    expect(getEmbedderHealth().lastFailureReason).toBe("authentication_error");
  });

  it("rejects invalid retry options before calling the embedder", async () => {
    const embed = vi.fn(async () => [1]);

    await expect(safeEmbed(embed, "x", { retries: -1 })).rejects.toThrow(
      /retries must be a non-negative integer/,
    );
    expect(embed).not.toHaveBeenCalled();
  });

  it("exposes embedder failures as observable state rather than console-only noise", async () => {
    const failing = async (): Promise<number[]> => {
      throw new Error("embedder down");
    };

    expect(await safeEmbed(failing, "x", { retryDelayMs: 0 })).toBeNull();
    const afterFailure = getEmbedderHealth();
    expect(afterFailure.consecutiveFailures).toBe(1);
    expect(afterFailure.lastFailureReason).toBe("provider_error");
    (afterFailure as { consecutiveFailures: number }).consecutiveFailures = 99;
    expect(getEmbedderHealth().consecutiveFailures).toBe(1);

    expect(await safeEmbed(async () => [1], "x")).toEqual([1]);
    expect(getEmbedderHealth().consecutiveFailures).toBe(0);
  });
});

describe("recallSemanticFromDb", () => {
  it("degrades to tag-only recall when the embedder throws (offline-safe)", async () => {
    const { loadDomainMemories } = await import("./domain-memory");
    (loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      rec({ key: "tagged", tags: ["firewall"] }),
    ]);
    const failing = async (): Promise<number[]> => {
      throw new Error("no network");
    };
    const out = await recallSemanticFromDb({
      domain: "sales",
      tags: ["firewall"],
      queryText: "anything",
      embed: failing,
      projectSlug: "unit-test-project",
    });
    expect(out.map((r) => r.key)).toEqual(["tagged"]);
  });

  it("does not inflate the tag-score denominator when the caller already passed the domain tag", async () => {
    const { loadDomainMemories } = await import("./domain-memory");
    // A: 두 태그가 모두 겹치지만 임베딩 없음 → 순수 태그 점수.
    // B: 태그는 하나도 안 겹치지만 임베딩이 완전 일치 → 0.7.
    // 중복 제거가 없으면 A 의 분모가 3 이 되어 0.667 로 떨어지고 B 에게 밀린다.
    (loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      rec({ key: "tag-match", tags: ["firewall", "domain:sales"] }),
      rec({ key: "embed-match", tags: [], embedding: [1, 0, 0] }),
    ]);
    const out = await recallSemanticFromDb({
      domain: "sales",
      // 호출자가 이미 domain:sales 를 포함해서 넘긴다 (runDomainStage 와 동일한 형태)
      tags: ["firewall", "domain:sales"],
      queryText: "anything",
      embed: async () => [1, 0, 0],
      projectSlug: "unit-test-project",
    });
    expect(out.map((r) => r.key)).toEqual(["tag-match", "embed-match"]);
  });

  it("honours an injected embeddingWeight so a similarity-only match can be excluded", async () => {
    const { loadDomainMemories } = await import("./domain-memory");
    (loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      rec({ key: "embed-only", tags: [], embedding: [1, 0, 0] }),
    ]);
    const query = {
      domain: "sales" as const,
      tags: ["firewall"],
      queryText: "anything",
      embed: async () => [1, 0, 0],
      projectSlug: "unit-test-project",
    };
    const withDefaultWeight = await recallSemanticFromDb(query);
    expect(withDefaultWeight.map((r) => r.key)).toEqual(["embed-only"]);

    (loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      rec({ key: "embed-only", tags: [], embedding: [1, 0, 0] }),
    ]);
    const tagsOnly = await recallSemanticFromDb({ ...query, options: { embeddingWeight: 0 } });
    expect(tagsOnly).toEqual([]);
  });
});
