/**
 * G001 red-team QA (unit level) — adversarial verification of the frozen change
 * set a95cc66..e599f5e. Red-team only: no product source is modified.
 *
 * Attacks covered here (DB layer mocked away):
 *  - dim-mismatch: 256-dim query vs 3-dim record embedding keeps FULL tag score
 *  - embedder-down: runDomainStage recall degrades to tags, learning upsert
 *    omits the embedding key, [domain-embedder] embed_failed warning emitted
 *  - poisoned-row: negative-outcome records with PERFECT embedding similarity
 *    stay suppressed
 *  - domain-isolation: cross-domain record with perfect embedding never surfaces
 *  - empty-vector embedder: safeEmbed returns null; runDomainStage stores nothing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hybridScore, recallHybrid, recallSemanticFromDb, safeEmbed } from "../domain-embedding";
import { scoreDomainMemory, type DomainMemoryRecord } from "../domain-memory";
import { runDomainStage, createStubGenerator } from "../domain-agent-runtime";
import { describeEmbedder } from "../domain-embedder-openai";

// 임베더 해석을 hash 로 고정 — 셸에 OPENAI_API_KEY/EMBEDDING_BASE_URL 이 있어도
// 테스트가 네트워크를 타면 안 된다.
vi.stubEnv("OPENAI_API_KEY", "");
vi.stubEnv("EMBEDDING_BASE_URL", "");

// DB 레이어만 모킹 — 스코어/recall/런타임 로직은 실제 코드로 검증한다.
vi.mock("../domain-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domain-memory")>();
  return {
    ...actual,
    loadDomainMemories: vi.fn(async () => [] as DomainMemoryRecord[]),
    recordDomainDecision: vi.fn(async () => ({}) as never),
    upsertDomainMemory: vi.fn(async () => ({}) as never),
  };
});

function rec(overrides: Partial<DomainMemoryRecord>): DomainMemoryRecord {
  return {
    domain: "sales",
    memoryType: "case",
    key: "k",
    label: "label",
    tags: [],
    outcome: "approved",
    confidence: 90,
    status: "active",
    ...overrides,
  };
}

/** 256-dim unit vector — matches the hash embedder dimension. */
function q256(): number[] {
  const v = new Array<number>(256).fill(0);
  v[0] = 1;
  return v;
}

describe("G001 red-team: dim-mismatch attack (unit)", () => {
  it("keeps the FULL tag score for a 3-dim record under a 256-dim query (never blended, never zeroed)", () => {
    const query = { domain: "sales" as const, tags: ["firewall"] };
    const mismatched = rec({ key: "dim3", tags: ["firewall"], embedding: [1, 0, 0] });

    const withMismatch = hybridScore(query, q256(), mismatched);
    const tagOnly = hybridScore(query, null, mismatched);
    const pureTag = scoreDomainMemory(query, mismatched);

    // exact equality with the null-embedding path = full tag score preserved
    expect(withMismatch).toBe(tagOnly);
    expect(withMismatch).toBe(pureTag);
    expect(withMismatch).toBeGreaterThan(0);
  });

  it("still recalls a dim-mismatched row via recallHybrid with a 256-dim query embedding", () => {
    const query = { domain: "sales" as const, tags: ["firewall"] };
    const mismatched = rec({ key: "dim3", tags: ["firewall"], embedding: [0.5, 0.5, 0.7] });
    const out = recallHybrid(query, q256(), [mismatched]);
    expect(out.map((r) => r.key)).toEqual(["dim3"]);
  });
});

describe("G001 red-team: poisoned-row attack (unit)", () => {
  const perfect = [1, 0, 0];

  it.each(["rejected", "human-reverted"] as const)(
    "never recalls a %s row even with perfect embedding similarity",
    (outcome) => {
      const poisoned = rec({ key: "poisoned", outcome, tags: ["firewall"], embedding: perfect });
      const control = rec({ key: "control", tags: ["firewall"], embedding: perfect });
      const out = recallHybrid({ domain: "sales", tags: ["firewall"] }, perfect, [poisoned, control]);
      expect(out.map((r) => r.key)).toEqual(["control"]);
      // suppressed even in isolation — no tag fallback can resurrect it
      expect(recallHybrid({ domain: "sales", tags: ["firewall"] }, perfect, [poisoned])).toEqual([]);
    },
  );
});

describe("G001 red-team: domain-isolation attack (unit)", () => {
  it("never surfaces a cfo row (perfect embedding) for a sales query", () => {
    const perfect = [1, 0, 0];
    const cfo = rec({ key: "cfo-leak", domain: "cfo", tags: ["firewall"], embedding: perfect });
    expect(recallHybrid({ domain: "sales", tags: ["firewall"] }, perfect, [cfo])).toEqual([]);
    expect(hybridScore({ domain: "sales", tags: ["firewall"] }, perfect, cfo)).toBe(0);
    // tag-only path is equally sealed
    expect(hybridScore({ domain: "sales", tags: ["firewall"] }, null, cfo)).toBe(0);
  });
});

describe("G001 red-team: safeEmbed edge cases (unit)", () => {
  it("returns null for an empty vector (no store, no crash)", async () => {
    expect(await safeEmbed(async () => [], "anything")).toBeNull();
  });

  it("returns null and warns [domain-embedder] embed_failed when the embedder throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = async (): Promise<number[]> => {
      throw new Error("embedder down");
    };
    expect(await safeEmbed(failing, "anything")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[domain-embedder] embed_failed"));
    warn.mockRestore();
  });
});

describe("G001 red-team: resolver precedence (unit)", () => {
  it("describeEmbedder: embedding-endpoint > openai > hash", () => {
    expect(describeEmbedder({ baseUrl: "http://embed.local/v1", apiKey: "sk-x" })).toBe("embedding-endpoint");
    expect(describeEmbedder({ baseUrl: "http://embed.local/v1", apiKey: "" })).toBe("embedding-endpoint");
    expect(describeEmbedder({ apiKey: "sk-x" })).toBe("openai");
    expect(describeEmbedder({ apiKey: "" })).toBe("hash");
  });
});

describe("G001 red-team: runDomainStage with injected embedder (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleCase = { id: "rt1", subject: "firewall renewal deal", tags: ["firewall"] };

  it("embedder-down attack: tag recall survives, upsert omits embedding, warning emitted", async () => {
    const memory = await import("../domain-memory");
    (memory.loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      rec({ key: "prior", label: "prior case", tags: ["firewall"] }),
    ]);
    const upsert = memory.upsertDomainMemory as ReturnType<typeof vi.fn>;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("embedder down");
    });
    const spyGen = vi.fn(createStubGenerator());

    const result = await runDomainStage("sales", sampleCase, {
      generate: spyGen,
      embed: failing as unknown as import("../domain-embedding").Embedder,
      projectSlug: "unit-test-project",
    });

    // 1) recall degraded to tags but still returns the matching memory
    expect(result.recalled.map((r) => r.key)).toContain("prior");
    expect(spyGen).toHaveBeenCalledWith(
      expect.objectContaining({
        recalled: expect.arrayContaining([expect.objectContaining({ key: "prior" })]),
      }),
    );
    // 2) learning write happens WITHOUT the embedding key
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.not.objectContaining({ embedding: expect.anything() }));
    expect(Object.keys(upsert.mock.calls[0][0])).not.toContain("embedding");
    // 3) failure evidence: [domain-embedder] embed_failed warning (recall + learning = 2)
    const embedWarns = warn.mock.calls.filter((c) => String(c[0]).includes("[domain-embedder] embed_failed"));
    expect(embedWarns.length).toBeGreaterThanOrEqual(1);
    warn.mockRestore();
  });

  it("empty-vector embedder: recall degrades, learning upsert stores no embedding", async () => {
    const memory = await import("../domain-memory");
    (memory.loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      rec({ key: "prior2", label: "prior case 2", tags: ["firewall"] }),
    ]);
    const upsert = memory.upsertDomainMemory as ReturnType<typeof vi.fn>;

    const result = await runDomainStage("sales", sampleCase, {
      generate: createStubGenerator(),
      embed: (async () => []) as import("../domain-embedding").Embedder,
      projectSlug: "unit-test-project",
    });

    expect(result.recalled.map((r) => r.key)).toContain("prior2");
    expect(upsert).toHaveBeenCalledWith(expect.not.objectContaining({ embedding: expect.anything() }));
  });

  it("degraded recall preserves top-K (5 candidates, topK=3 → exactly 3)", async () => {
    const memory = await import("../domain-memory");
    (memory.loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      [1, 2, 3, 4, 5].map((i) => rec({ key: `k${i}`, tags: ["firewall"], createdAt: new Date(2026, 0, i) })),
    );
    const failing = async (): Promise<number[]> => {
      throw new Error("offline");
    };
    const out = await recallSemanticFromDb({
      domain: "sales",
      tags: ["firewall"],
      queryText: "probe",
      embed: failing,
      projectSlug: "unit-test-project",
      topK: 3,
    });
    expect(out).toHaveLength(3);
    // newest-first tie-break survives degradation
    expect(out.map((r) => r.key)).toEqual(["k5", "k4", "k3"]);
  });

  it("working injected embedder: learning upsert stores a 256-dim hash embedding", async () => {
    const memory = await import("../domain-memory");
    const upsert = memory.upsertDomainMemory as ReturnType<typeof vi.fn>;
    await runDomainStage("sales", sampleCase, {
      generate: createStubGenerator(),
      projectSlug: "unit-test-project",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: "sales:rt1", embedding: expect.any(Array) }),
    );
    expect((upsert.mock.calls[0][0] as { embedding: number[] }).embedding).toHaveLength(256);
  });
});
