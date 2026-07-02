import { describe, it, expect } from "vitest";
import {
  scoreDomainMemory,
  recallDomainMemories,
  buildMemoryTags,
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

describe("scoreDomainMemory — negative learning (rejected must NOT be recommended)", () => {
  const query: RecallQuery = { domain: "sales", tags: ["domain:sales", "intent:approved"] };

  it("approved outcome with overlapping tags scores > 0", () => {
    expect(
      scoreDomainMemory(query, rec({ tags: ["domain:sales", "intent:approved"], outcome: "approved" })),
    ).toBeGreaterThan(0);
  });

  it("rejected outcome with overlapping tags scores <= 0 (NOT recommended)", () => {
    expect(
      scoreDomainMemory(query, rec({ tags: ["domain:sales", "intent:approved"], outcome: "rejected" })),
    ).toBeLessThanOrEqual(0);
  });

  // PLAN §6 Gate 9 — suppression probe. MUST stay a todo until cross-candidate
  // suppression is implemented (PLAN §7): recallDomainMemories scores each
  // candidate independently and .filter(score>0)s — a rejected memory only
  // drops ITSELF; it cannot remove or down-rank a SEPARATE positive memory for
  // the same case. The tests above prove self-drop only. Do NOT green-light
  // "negative learning" by injecting a lone rejected memory and asserting its
  // own absence — that is the false sign-off this todo exists to prevent.
  it.todo(
    "same-case rejected memory suppresses/down-ranks a separate positive memory (cross-candidate — UNIMPLEMENTED, PLAN §7)",
  );

  it("source=human approved scores >= non-human approved with same tags", () => {
    const humanScore = scoreDomainMemory(
      query,
      rec({ tags: ["domain:sales", "intent:approved"], outcome: "approved", source: "human" }),
    );
    const agentScore = scoreDomainMemory(
      query,
      rec({ tags: ["domain:sales", "intent:approved"], outcome: "approved", source: "agent" }),
    );
    expect(humanScore).toBeGreaterThanOrEqual(agentScore);
  });

  it("empty query tags returns 0 (unchanged behavior)", () => {
    expect(
      scoreDomainMemory(
        { domain: "sales", tags: [] },
        rec({ tags: ["domain:sales"], outcome: "approved" }),
      ),
    ).toBe(0);
  });
});

describe("buildMemoryTags", () => {
  it("returns domain tag for domain-only call", () => {
    expect(buildMemoryTags({ domain: "cfo" })).toEqual(["domain:cfo"]);
  });

  it("includes intentTag when provided", () => {
    expect(buildMemoryTags({ domain: "cfo", intentTag: "approved" })).toEqual([
      "domain:cfo",
      "intent:approved",
    ]);
  });

  it("includes entityType when provided", () => {
    expect(buildMemoryTags({ domain: "sales", entityType: "proposal" })).toEqual([
      "domain:sales",
      "entity:proposal",
    ]);
  });

  it("includes all three when all provided", () => {
    expect(
      buildMemoryTags({ domain: "sales", entityType: "proposal", intentTag: "corrected" }),
    ).toEqual(["domain:sales", "entity:proposal", "intent:corrected"]);
  });

  it("is lowercased and deterministic", () => {
    const a = buildMemoryTags({ domain: "cfo", intentTag: "approved" });
    const b = buildMemoryTags({ domain: "cfo", intentTag: "approved" });
    expect(a).toEqual(b);
    expect(a.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it("drops falsy parts (no entityType, no intentTag)", () => {
    const result = buildMemoryTags({ domain: "marketing" });
    expect(result).toEqual(["domain:marketing"]);
    expect(result.every(Boolean)).toBe(true);
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
