import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  hybridScore,
  recallHybrid,
} from "./domain-embedding";
import type { DomainMemoryRecord, RecallQuery } from "./domain-memory";

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
});
