import { describe, it, expect, vi } from "vitest";
import { extractJsonObject } from "./opencode-structured";
import { createOpencodeStructuredGenerator, summarizeStructured } from "./domain-structured";
import { schemaForDomain } from "./domain-artifact-schema";
import { createResilientDomainGenerator } from "./domain-llm-fallback";
import { buildDomainDashboardSnapshot, type DomainStatsLoader } from "./domain-dashboard";
import { createHashEmbedder, embeddingTextFor } from "./domain-embedder";
import { cosineSimilarity } from "./domain-embedding";
import type { DomainGenerator } from "./domain-agent-runtime";

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  return vi.fn(async (url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: "",
    json: async () => handler(url, init),
  })) as unknown as typeof fetch;
}

// ── ② Structured output ──────────────────────────────────────────────
describe("② structured output", () => {
  it("schemaForDomain returns a JSON schema with required fields", () => {
    expect(schemaForDomain("cfo").properties).toHaveProperty("decision");
    expect(schemaForDomain("sales").required).toContain("customer");
  });

  it("extractJsonObject pulls a JSON object out of wrapping text", () => {
    expect(extractJsonObject('blah ```json\n{"a":1,"b":[2]}\n``` end')).toEqual({ a: 1, b: [2] });
    expect(extractJsonObject("no json here")).toBeNull();
  });

  it("summarizeStructured renders key fields", () => {
    const s = summarizeStructured("cfo", { decision: "approved", marginPct: 22, rationale: "ok" });
    expect(s).toContain("decision");
    expect(s).toContain("approved");
  });

  it("generator returns structured payload from info.structured_output", async () => {
    const fetchImpl = mockFetch((url) =>
      (url as string).endsWith("/session")
        ? { id: "s1" }
        : { info: { structured: { decision: "approved", marginPct: 20, rationale: "good" } }, parts: [] },
    );
    const gen = createOpencodeStructuredGenerator({ fetchImpl });
    const artifact = await gen({
      domain: "cfo",
      case: { id: "c1", subject: "x", tags: [] },
      recalled: [],
      prompt: "P",
    });
    expect((artifact.payload as any).structured.decision).toBe("approved");
    expect(artifact.summary).toContain("approved");
  });
});

// ── ① Fallback chain ─────────────────────────────────────────────────
describe("① availability fallback chain", () => {
  const input = { domain: "sales" as const, case: { id: "c", subject: "s", tags: [] }, recalled: [], prompt: "p" };
  const ok = (tag: string): DomainGenerator => async () => ({ produces: "x", summary: tag });
  const boom: DomainGenerator = async () => {
    throw new Error("model down");
  };

  it("uses the first generator that succeeds", async () => {
    const gen = createResilientDomainGenerator([ok("primary"), ok("backup")]);
    expect((await gen(input)).summary).toBe("primary");
  });

  it("falls through to the next on failure", async () => {
    const gen = createResilientDomainGenerator([boom, ok("backup")]);
    expect((await gen(input)).summary).toBe("backup");
  });

  it("falls back to stub when all fail", async () => {
    const gen = createResilientDomainGenerator([boom, boom]);
    const out = await gen(input);
    expect(out.produces).toBe("opportunity-with-quote"); // stub uses domain definition
  });

  it("short-circuits to stub when health check fails", async () => {
    const primary = vi.fn(ok("primary"));
    const gen = createResilientDomainGenerator([primary], { healthCheck: async () => false });
    await gen(input);
    expect(primary).not.toHaveBeenCalled();
  });
});

// ── ④ Dashboard snapshot ─────────────────────────────────────────────
describe("④ dashboard snapshot", () => {
  it("builds a row per GTM domain with stats and totals", async () => {
    const loader: DomainStatsLoader = async (domain) => ({
      memoryCount: domain === "cfo" ? 3 : 1,
      decisionCount: 2,
      lastDecisionAt: new Date("2026-06-01"),
      lastOutcome: "approved",
    });
    const snap = await buildDomainDashboardSnapshot(loader);
    expect(snap.rows.map((r) => r.domain)).toEqual(["marketing", "sales", "presales", "engineer", "cfo"]);
    expect(snap.totals.decisions).toBe(10); // 5 domains × 2
    expect(snap.totals.memories).toBe(7); // 4×1 + 3
    expect(snap.rows.find((r) => r.domain === "cfo")?.lastOutcome).toBe("approved");
  });
});

// ── ③ Embedding backfill ─────────────────────────────────────────────
describe("③ hash embedder", () => {
  it("is deterministic and L2-normalized at the right dimension", async () => {
    const embed = createHashEmbedder(64);
    const a = await embed("Sangfor 방화벽 firewall");
    const b = await embed("Sangfor 방화벽 firewall");
    expect(a.length).toBe(64);
    expect(a).toEqual(b);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1);
  });

  it("similar texts score higher than dissimilar ones", async () => {
    const embed = createHashEmbedder(256);
    const base = await embed("firewall security enterprise ngaf");
    const near = await embed("firewall security enterprise");
    const far = await embed("marketing newsletter campaign");
    expect(cosineSimilarity(base, near)).toBeGreaterThan(cosineSimilarity(base, far));
  });

  it("embeddingTextFor joins label, tags, summary", () => {
    expect(embeddingTextFor({ label: "L", tags: ["a", "b"], summary: "S" })).toBe("L\na b\nS");
  });
});
