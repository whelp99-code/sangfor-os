import { describe, it, expect, vi } from "vitest";
import {
  buildDomainPrompt,
  runDomainStage,
  runDomainPipeline,
  createStubGenerator,
  type DomainCase,
  type DomainRuntimeDeps,
} from "./domain-agent-runtime";
import type { DomainMemoryRecord } from "./domain-memory";

// 임베더 해석을 hash 로 고정 — 셸에 OPENAI_API_KEY/EMBEDDING_BASE_URL 이 있어도
// 테스트가 네트워크를 타면 안 된다.
vi.stubEnv("OPENAI_API_KEY", "");
vi.stubEnv("EMBEDDING_BASE_URL", "");

// DB 레이어를 모킹해 런타임 로직만 검증 (DB 불필요).
vi.mock("./domain-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domain-memory")>();
  return {
    ...actual,
    loadDomainMemories: vi.fn(async () => [] as DomainMemoryRecord[]),
    recordDomainDecision: vi.fn(async () => ({}) as never),
    upsertDomainMemory: vi.fn(async () => ({}) as never),
  };
});

vi.mock("../infrastructure/default-project", () => ({
  resolveDefaultProjectSlug: vi.fn(async () => "unit-test-project"),
}));

const sampleCase: DomainCase = {
  id: "c1",
  subject: "Sangfor 방화벽 문의",
  tags: ["firewall", "security"],
};

describe("buildDomainPrompt", () => {
  it("includes domain, case, and recall context", () => {
    const prompt = buildDomainPrompt("sales", sampleCase, []);
    expect(prompt).toContain("영업");
    expect(prompt).toContain("Sangfor 방화벽 문의");
    expect(prompt).toContain("첫 학습");
  });

  it("lists recalled prior cases as few-shot", () => {
    const recalled: DomainMemoryRecord[] = [
      { domain: "sales", memoryType: "case", key: "k", label: "이전 견적", tags: ["firewall"], outcome: "approved", confidence: 90, status: "active" },
    ];
    const prompt = buildDomainPrompt("sales", sampleCase, recalled);
    expect(prompt).toContain("과거 유사 케이스 1건");
    expect(prompt).toContain("이전 견적");
  });
});

describe("runDomainStage", () => {
  const deps: DomainRuntimeDeps = { generate: createStubGenerator() };

  it("produces an artifact, passes the default gate, and hands off to next domain", async () => {
    const result = await runDomainStage("marketing", sampleCase, deps);
    expect(result.artifact.produces).toBe("qualified-lead");
    expect(result.requiredLenses.sort()).toEqual(["orange", "teal"]);
    expect(result.gatePass).toBe(true);
    expect(result.handoffTo).toBe("sales");
  });

  it("fails the gate (and blocks handoff) when a required lens fails", async () => {
    const failingDeps: DomainRuntimeDeps = {
      generate: createStubGenerator(),
      evaluateGate: async ({ required }) => ({ reviewed: required, failed: [required[0]] }),
    };
    const result = await runDomainStage("sales", sampleCase, failingDeps);
    expect(result.gatePass).toBe(false);
    expect(result.handoffTo).toBeNull();
  });

  it("invokes the injected persister on gate pass and attaches the result", async () => {
    const persist = vi.fn(async () => ({ domain: "marketing" as const, persisted: [{ entity: "Opportunity", id: "x" }] }));
    const result = await runDomainStage("marketing", sampleCase, { generate: createStubGenerator(), persist });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "marketing", case: sampleCase }),
    );
    expect(result.persisted?.persisted[0].entity).toBe("Opportunity");
  });

  it("does NOT persist when the gate fails", async () => {
    const persist = vi.fn(async () => ({ domain: "sales" as const, persisted: [] }));
    const result = await runDomainStage("sales", sampleCase, {
      generate: createStubGenerator(),
      persist,
      evaluateGate: async ({ required }) => ({ reviewed: required, failed: [required[0]] }),
    });
    expect(persist).not.toHaveBeenCalled();
    expect(result.persisted).toBeNull();
  });

  it("passes recalled memories into the generator via semantic recall", async () => {
    const memory = await import("./domain-memory");
    (memory.loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { domain: "sales", memoryType: "case", key: "k", label: "prior", tags: ["firewall"], outcome: "approved", confidence: 90, status: "active" },
    ]);
    const spyGen = vi.fn(createStubGenerator());
    await runDomainStage("sales", sampleCase, { generate: spyGen });
    expect(spyGen).toHaveBeenCalledWith(
      expect.objectContaining({ recalled: expect.arrayContaining([expect.objectContaining({ label: "prior" })]) }),
    );
  });

  it("stores a best-effort hash embedding with the learning upsert", async () => {
    const memory = await import("./domain-memory");
    const upsert = memory.upsertDomainMemory as ReturnType<typeof vi.fn>;
    upsert.mockClear();
    await runDomainStage("marketing", sampleCase, { generate: createStubGenerator() });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: "marketing:c1", embedding: expect.any(Array) }),
    );
    expect((upsert.mock.calls[0][0] as { embedding: number[] }).embedding).toHaveLength(256);
  });

  it("degrades to tag-only recall and omits embedding when the injected embedder fails", async () => {
    const memory = await import("./domain-memory");
    (memory.loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { domain: "sales", memoryType: "case", key: "k2", label: "prior", tags: ["firewall"], outcome: "approved", confidence: 90, status: "active" },
    ]);
    const upsert = memory.upsertDomainMemory as ReturnType<typeof vi.fn>;
    upsert.mockClear();
    const failing = vi.fn(async () => {
      throw new Error("embedder down");
    }) as unknown as import("./domain-embedding").Embedder;
    const spyGen = vi.fn(createStubGenerator());
    await runDomainStage("sales", sampleCase, { generate: spyGen, embed: failing });
    // 태그 경로가 살아있어 recall 은 계속 동작한다
    expect(spyGen).toHaveBeenCalledWith(
      expect.objectContaining({ recalled: expect.arrayContaining([expect.objectContaining({ label: "prior" })]) }),
    );
    // 학습 쓰기는 임베딩 없이 계속된다
    expect(upsert).toHaveBeenCalledWith(expect.not.objectContaining({ embedding: expect.anything() }));
  });

  it("forwards recallOptions so embeddingWeight is tunable from the runtime", async () => {
    const memory = await import("./domain-memory");
    // 태그는 하나도 안 겹치고 임베딩만 완전 일치하는 후보 — 의미 점수로만 올라온다
    const embeddingOnly = {
      domain: "sales" as const,
      memoryType: "case" as const,
      key: "embed-only",
      label: "embedding only",
      tags: [] as string[],
      outcome: "approved" as const,
      confidence: 90,
      status: "active",
      embedding: [1, 0, 0],
    };
    const embed = async () => [1, 0, 0];

    (memory.loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([embeddingOnly]);
    const withDefault = await runDomainStage("sales", sampleCase, {
      generate: createStubGenerator(),
      embed,
    });
    expect(withDefault.recalled.map((r) => r.key)).toEqual(["embed-only"]);

    (memory.loadDomainMemories as ReturnType<typeof vi.fn>).mockResolvedValueOnce([embeddingOnly]);
    const tagsOnly = await runDomainStage("sales", sampleCase, {
      generate: createStubGenerator(),
      embed,
      recallOptions: { embeddingWeight: 0 },
    });
    expect(tagsOnly.recalled).toEqual([]);
  });
});

describe("runDomainPipeline", () => {
  it("runs all six GTM domains end-to-end on passing gates", async () => {
    const results = await runDomainPipeline(sampleCase, { generate: createStubGenerator() });
    expect(results.map((r) => r.domain)).toEqual(["marketing", "sales", "sales_support", "presales", "engineer", "cfo"]);
    expect(results.every((r) => r.gatePass)).toBe(true);
    expect(results[results.length - 1].handoffTo).toBeNull();
  });

  it("halts the pipeline at the first failing gate", async () => {
    const deps: DomainRuntimeDeps = {
      generate: createStubGenerator(),
      evaluateGate: async ({ domain, required }) =>
        domain === "presales"
          ? { reviewed: required, failed: [required[0]] }
          : { reviewed: required, failed: [] },
    };
    const results = await runDomainPipeline(sampleCase, deps);
    expect(results.map((r) => r.domain)).toEqual(["marketing", "sales", "sales_support", "presales"]);
    expect(results[results.length - 1].gatePass).toBe(false);
  });

  it("defaults to createDefaultDomainGenerator when no generate is injected (opencode down → stub)", async () => {
    // No generate injected → runtime builds the default generator; with opencode
    // unreachable (fetch rejects) the resilient chain falls back to the stub.
    const failFetch = vi.fn(async () => {
      throw new Error("opencode unreachable");
    }) as unknown as typeof fetch;
    const results = await runDomainPipeline(sampleCase, {
      defaultGeneratorOptions: { fetchImpl: failFetch },
    });
    expect(results.map((r) => r.domain)).toEqual([
      "marketing",
      "sales",
      "sales_support",
      "presales",
      "engineer",
      "cfo",
    ]);
    expect(results.every((r) => r.gatePass)).toBe(true);
    // stub artifact carries recalledCount in its payload
    expect(results[0].artifact.payload).toHaveProperty("recalledCount");
  });

  it("runDomainStage also resolves the default generator when generate is omitted", async () => {
    const failFetch = vi.fn(async () => {
      throw new Error("opencode unreachable");
    }) as unknown as typeof fetch;
    const result = await runDomainStage("marketing", sampleCase, {
      defaultGeneratorOptions: { fetchImpl: failFetch },
    });
    expect(result.artifact.produces).toBe("qualified-lead");
    expect(result.gatePass).toBe(true);
  });
});
