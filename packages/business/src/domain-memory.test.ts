import { describe, it, expect } from "vitest";
import {
  scoreDomainMemory,
  recallDomainMemories,
  type DomainMemoryRecord,
  type RecallQuery,
} from "./domain-memory";

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

describe("scoreDomainMemory (격리 + 가중)", () => {
  const query: RecallQuery = { domain: "sales", tags: ["firewall", "discount"] };

  it("scores 0 for a different domain (소유 경계 격리)", () => {
    expect(scoreDomainMemory(query, rec({ domain: "cfo", tags: ["firewall"] }))).toBe(0);
  });

  it("scores 0 for inactive records", () => {
    expect(scoreDomainMemory(query, rec({ tags: ["firewall"], status: "archived" }))).toBe(0);
  });

  it("scores 0 when no tag overlaps", () => {
    expect(scoreDomainMemory(query, rec({ tags: ["renewal"] }))).toBe(0);
  });

  it("rewards more tag overlap", () => {
    const one = scoreDomainMemory(query, rec({ tags: ["firewall"] }));
    const two = scoreDomainMemory(query, rec({ tags: ["firewall", "discount"] }));
    expect(two).toBeGreaterThan(one);
  });

  it("weights approved over rejected outcomes", () => {
    const approved = scoreDomainMemory(query, rec({ tags: ["firewall"], outcome: "approved" }));
    const rejected = scoreDomainMemory(query, rec({ tags: ["firewall"], outcome: "rejected" }));
    expect(approved).toBeGreaterThan(rejected);
  });

  it("scales with confidence", () => {
    const hi = scoreDomainMemory(query, rec({ tags: ["firewall"], confidence: 100 }));
    const lo = scoreDomainMemory(query, rec({ tags: ["firewall"], confidence: 50 }));
    expect(hi).toBeGreaterThan(lo);
  });

  it("is case-insensitive on tags", () => {
    expect(scoreDomainMemory(query, rec({ tags: ["FireWall"] }))).toBeGreaterThan(0);
  });

  it("scores 0 for an empty query", () => {
    expect(scoreDomainMemory({ domain: "sales", tags: [] }, rec({ tags: ["firewall"] }))).toBe(0);
  });
});

describe("recallDomainMemories (top-K)", () => {
  const query: RecallQuery = { domain: "sales", tags: ["firewall", "discount"] };

  it("returns only matching, sorted best-first, capped at topK", () => {
    const candidates: DomainMemoryRecord[] = [
      rec({ key: "best", tags: ["firewall", "discount"], outcome: "approved" }),
      rec({ key: "mid", tags: ["firewall"], outcome: "approved" }),
      rec({ key: "weak", tags: ["firewall"], outcome: "rejected" }),
      rec({ key: "other-domain", domain: "cfo", tags: ["firewall", "discount"] }),
      rec({ key: "no-overlap", tags: ["renewal"] }),
    ];
    const out = recallDomainMemories(query, candidates, 2);
    expect(out.map((r) => r.key)).toEqual(["best", "mid"]);
  });

  it("breaks ties by recency", () => {
    const older = rec({ key: "older", tags: ["firewall"], createdAt: new Date("2026-01-01") });
    const newer = rec({ key: "newer", tags: ["firewall"], createdAt: new Date("2026-06-01") });
    const out = recallDomainMemories(query, [older, newer]);
    expect(out[0].key).toBe("newer");
  });
});
