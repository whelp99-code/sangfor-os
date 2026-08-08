/**
 * G001 red-team QA — generation 4 delta (6c07521..7eeb519).
 * Test-only delta: domain-proposal.test.ts gained a module-scope env pin
 * (OPENAI_API_KEY, EMBEDDING_BASE_URL forced to "") and a new
 * "recalls a zero-tag-overlap memory on embedding similarity alone" case.
 *
 * Two attacks:
 *  1. Hermeticity — even if OPENAI_API_KEY / EMBEDDING_BASE_URL are set to a
 *     hostile, unreachable value BEFORE the process/module loads, the pin
 *     must still force the offline hash fallback and the suite must never
 *     attempt outbound HTTP. Proven here with a `global.fetch` spy that
 *     throws synchronously if invoked, plus elapsed-time evidence.
 *  2. Anti-tautology — the new shipped case's candidate has `tags: []`. We
 *     prove independently (against the shipped hybridScore/recallHybrid
 *     functions, not by editing the shipped test) that removing the
 *     embedding term (queryEmbedding: null) makes hybridScore return exactly
 *     the tag score (0, since scoreDomainMemory returns 0 for empty query
 *     tags / zero overlap), and recallHybrid's `score > 0` filter drops the
 *     record entirely — so the shipped case could NOT pass on tag matching
 *     alone; the embedding term is load-bearing for it.
 *
 * No product source or shipped test file is modified.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../domain-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../domain-memory")>();
  return {
    ...actual,
    loadDomainMemories: vi.fn().mockResolvedValue([]),
    recordDomainDecision: vi.fn().mockResolvedValue({ id: "mock-id" }),
  };
});

vi.mock("../color-gate-llm", () => ({
  verifyProposalColorGate: vi.fn().mockResolvedValue(undefined),
}));

describe("G001 red-team gen4: hermeticity of the domain-proposal env pin", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalBaseUrl = process.env.EMBEDDING_BASE_URL;

  beforeEach(() => {
    vi.resetModules();
    // Simulate a hostile pre-set environment: a real-looking key and an
    // unreachable-but-instantly-refusing endpoint (closed port), exactly the
    // scenario the acceptance attack asks us to reproduce.
    process.env.OPENAI_API_KEY = "sk-hostile-should-never-be-dialed";
    process.env.EMBEDDING_BASE_URL = "http://127.0.0.1:9";
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.EMBEDDING_BASE_URL = originalBaseUrl;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("with hostile env pre-set, the same vi.stubEnv('') pattern the shipped file uses forces the hash fallback and NEVER calls fetch", async () => {
    // Reproduce the shipped file's protective idiom exactly (domain-proposal.test.ts:7-8),
    // applied AFTER the hostile process.env values above — this is the same
    // ordering vitest gives every test file: module-scope code (including
    // vi.stubEnv calls) runs at import time, before any test body.
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("EMBEDDING_BASE_URL", "");

    const fetchSpy = vi.fn(() => {
      throw new Error("HERMETICITY VIOLATION: outbound fetch was attempted");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { resolveEmbedder, describeEmbedder } = await import("../domain-embedder-openai");
    const { generateDomainProposal } = await import("../domain-proposal");

    // describeEmbedder must report the offline hash embedder, not openai/endpoint.
    expect(describeEmbedder()).toBe("hash");

    const embedder = resolveEmbedder();
    const start = performance.now();
    const vec = await embedder("some proposal text");
    const embedElapsedMs = performance.now() - start;

    expect(vec.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    // A closed-port dial would still take real (if small) socket time; the
    // hash embedder is pure computation and should be sub-millisecond-to-low-ms.
    expect(embedElapsedMs).toBeLessThan(50);

    // End-to-end through generateDomainProposal itself (deps.embed NOT
    // supplied, so it falls through to resolveEmbedder() exactly like the
    // shipped "recalls a zero-tag-overlap memory" case does for its own
    // internal embeddingTextFor(query) call).
    const result = await generateDomainProposal(
      { engagementId: "e_herm", domain: "sales", engagementName: "hermeticity probe" },
      {
        callLLM: async () => '{"title":"T","bodyMarkdown":"B"}',
        getProjectSlug: async () => "test-project",
      },
    );

    expect(result.title).toBe("T");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("control: WITHOUT the vi.stubEnv('') pin, the hostile env resolves to the openai-endpoint embedder (proves the spy/harness itself is capable of detecting a real dial attempt)", async () => {
    // No vi.stubEnv here — hostile process.env values from beforeEach stand as-is.
    const { resolveEmbedder, describeEmbedder } = await import("../domain-embedder-openai");

    // EMBEDDING_BASE_URL takes precedence over the API key per resolveEmbedder's
    // documented precedence (embeddingEndpoint() wins first) — this on its own
    // confirms the harness is wired to the real env, i.e. the pinned test's
    // "hash-offline" result above is not a coincidental default.
    expect(describeEmbedder()).not.toBe("hash");

    const fetchSpy = vi.fn(() =>
      Promise.reject(new Error("ECONNREFUSED (expected: closed port, proves the dial was attempted)")),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const embedder = resolveEmbedder();
    await expect(embedder("would dial the hostile endpoint")).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("G001 red-team gen4: anti-tautology of the zero-tag-overlap semantic case", () => {
  it("hybridScore returns exactly the tag score (0) when the embedding term is removed for a tags:[] candidate — the shipped case is NOT tag-recallable", async () => {
    const { hybridScore, recallHybrid } = await import("../domain-embedding");

    const zeroTagRecord = {
      id: "scratch-1",
      domain: "sales" as const,
      memoryType: "case" as const,
      key: "eng:e_semantic:sales",
      label: "유사 딜 메모: 방화벽 갱신 할인 구조",
      tags: [] as string[],
      outcome: "approved" as const,
      confidence: 90,
      status: "active" as const,
      source: "human" as const,
      embedding: [1, 0, 0],
      createdAt: new Date(),
    };
    const query = { domain: "sales" as const, tags: [] as string[] };

    // With the embedding term present (queryEmbedding matches record.embedding
    // exactly, cosine similarity = 1): the shipped case's condition.
    const scoreWithEmbedding = hybridScore(query, [1, 0, 0], zeroTagRecord);
    expect(scoreWithEmbedding).toBeGreaterThan(0);
    expect(scoreWithEmbedding).toBeCloseTo(0.7, 5); // default embeddingWeight=0.7, tagScore=0

    // Remove ONLY the embedding term (queryEmbedding: null) — everything else
    // held constant. hybridScore's !hasEmbedding branch (domain-embedding.ts:64-69)
    // falls back to tagScore = scoreDomainMemory(query, record), which is 0
    // both because query.tags is empty (domain-memory.ts:89: "query.tags.length
    // === 0 return 0") and because record.tags is also empty (no overlap
    // possible either way).
    const scoreWithoutEmbedding = hybridScore(query, null, zeroTagRecord);
    expect(scoreWithoutEmbedding).toBe(0);

    // recallHybrid filters entries with score > 0 (domain-embedding.ts:97) —
    // a 0-score record is dropped from the result set entirely, not merely
    // ranked last. This proves the shipped test's assertion
    // (seen.join('\n')).toContain(label)) would FAIL without the embedding
    // term: the memory would never even reach buildDomainPrompt.
    const recalledWithEmbedding = recallHybrid(query, [1, 0, 0], [zeroTagRecord]);
    expect(recalledWithEmbedding).toHaveLength(1);
    expect(recalledWithEmbedding[0].key).toBe(zeroTagRecord.key);

    const recalledWithoutEmbedding = recallHybrid(query, null, [zeroTagRecord]);
    expect(recalledWithoutEmbedding).toHaveLength(0);
  });

  it("scoreDomainMemory alone (tag-only path) also returns 0 for this exact record/query pair, independent of hybridScore's branch logic", async () => {
    const { scoreDomainMemory } = await import("../domain-memory");
    const zeroTagRecord = {
      id: "scratch-2",
      domain: "sales" as const,
      memoryType: "case" as const,
      key: "eng:e_semantic:sales",
      label: "유사 딜 메모: 방화벽 갱신 할인 구조",
      tags: [] as string[],
      outcome: "approved" as const,
      confidence: 90,
      status: "active" as const,
      source: "human" as const,
      embedding: [1, 0, 0],
      createdAt: new Date(),
    };
    expect(scoreDomainMemory({ domain: "sales", tags: [] }, zeroTagRecord)).toBe(0);
  });
});
