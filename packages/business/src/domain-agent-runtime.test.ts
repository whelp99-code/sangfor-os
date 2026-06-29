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

// DB 레이어를 모킹해 런타임 로직만 검증 (DB 불필요).
vi.mock("./domain-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domain-memory")>();
  return {
    ...actual,
    recallFromDb: vi.fn(async () => [] as DomainMemoryRecord[]),
    recordDomainDecision: vi.fn(async () => ({}) as never),
    upsertDomainMemory: vi.fn(async () => ({}) as never),
  };
});

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

  it("passes recalled memories into the generator", async () => {
    const memory = await import("./domain-memory");
    (memory.recallFromDb as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { domain: "sales", memoryType: "case", key: "k", label: "prior", tags: ["firewall"], outcome: "approved", confidence: 90, status: "active" },
    ]);
    const spyGen = vi.fn(createStubGenerator());
    await runDomainStage("sales", sampleCase, { generate: spyGen });
    expect(spyGen).toHaveBeenCalledWith(
      expect.objectContaining({ recalled: expect.arrayContaining([expect.objectContaining({ label: "prior" })]) }),
    );
  });
});

describe("runDomainPipeline", () => {
  it("runs all five GTM domains end-to-end on passing gates", async () => {
    const results = await runDomainPipeline(sampleCase, { generate: createStubGenerator() });
    expect(results.map((r) => r.domain)).toEqual(["marketing", "sales", "presales", "engineer", "cfo"]);
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
    expect(results.map((r) => r.domain)).toEqual(["marketing", "sales", "presales"]);
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
