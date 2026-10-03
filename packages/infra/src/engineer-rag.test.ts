import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { normalizeRagSearchResult } from "./engineer-rag";

const text = "  NDR 3.0.8\n검증된 문서 발췌입니다.\n";
const textSha256 = createHash("sha256").update(text, "utf8").digest("hex");
const hit = {
  id: "manual-1",
  title: "NDR manual",
  section: "Installation",
  text,
  source: "https://support.example/manual",
  product: "NDR",
  version: "3.0.8",
  trustLevel: "official",
  sourceType: "manual",
  score: 0.9,
  rerankScore: 2,
  retrievalMode: "semantic",
};

describe("normalizeRagSearchResult", () => {
  it("normalizes an envelope, hashes exact text and preserves diagnostics", () => {
    const diagnostics = {
      searchMode: "semantic",
      degraded: false,
      evidenceRequirement: "live-runtime",
      counts: { candidates: 4, dropped: 1 },
      warnings: ["example"],
    };
    const result = normalizeRagSearchResult({ query: "NDR", results: [hit], diagnostics });
    expect(result).toEqual({ query: "NDR", results: [{ ...hit, textSha256 }], diagnostics });
    expect(result.diagnostics).not.toBe(diagnostics);
  });

  it("supports legacy filePath provenance without inventing health, version or trust", () => {
    const result = normalizeRagSearchResult([{ id: "legacy", text: "legacy", filePath: "/knowledge/old.md" }]);
    expect(result.results[0]).toMatchObject({ id: "legacy", text: "legacy", source: "/knowledge/old.md" });
    expect(result.results[0].trustLevel).toBeUndefined();
    expect(result.results[0].version).toBeUndefined();
    expect(result.results[0].product).toBeUndefined();
    expect(result.results[0].title).toBeUndefined();
    expect(result.results[0]).not.toHaveProperty("sourceVisibility");
    expect(result.results[0]).not.toHaveProperty("customerShareable");
    expect(result.diagnostics).toBeUndefined();
  });

  it("does not infer public visibility or sharing permission from official trust and a Sangfor URL", () => {
    const result = normalizeRagSearchResult({ results: [{ ...hit, source: "https://www.sangfor.com/manual" }] });
    expect(result.results[0]).not.toHaveProperty("sourceVisibility");
    expect(result.results[0]).not.toHaveProperty("customerShareable");
  });

  it("preserves explicitly public and customer-shareable provenance", () => {
    const result = normalizeRagSearchResult({ results: [{ ...hit, sourceVisibility: "public", customerShareable: true }] });
    expect(result.results[0]).toEqual({ ...hit, sourceVisibility: "public", customerShareable: true, textSha256 });
  });

  it.each(["public", "internal", "restricted", "unknown"])("preserves %s visibility and explicit sharing denial", (sourceVisibility) => {
    const result = normalizeRagSearchResult([{ ...hit, sourceVisibility, customerShareable: false }]);
    expect(result.results[0].sourceVisibility).toBe(sourceVisibility);
    expect(result.results[0].customerShareable).toBe(false);
  });

  it("does not infer either sharing field from the other", () => {
    const result = normalizeRagSearchResult([
      { ...hit, sourceVisibility: "public" },
      { ...hit, customerShareable: true },
    ]);
    expect(result.results[0]).not.toHaveProperty("customerShareable");
    expect(result.results[1]).not.toHaveProperty("sourceVisibility");
  });

  it("keeps an explicit source in preference to a legacy filePath", () => {
    const result = normalizeRagSearchResult([{ ...hit, filePath: "/knowledge/manual.md" }]);
    expect(result.results[0].source).toBe(hit.source);
  });

  it("strips raw vectors, unrelated hashes and all unknown evidence fields", () => {
    const result = normalizeRagSearchResult({
      results: [{ ...hit, vector: [1, 2], embedding: [2, 1], contentHash: "unverified", privateNote: "private", filePath: "/a" }],
      privateNote: "private",
    });
    expect(result.results[0]).toEqual({ ...hit, textSha256 });
    expect(result).not.toHaveProperty("privateNote");
  });

  it("preserves unknown trust and search mode strings rather than upgrading them", () => {
    const result = normalizeRagSearchResult({ results: [{ ...hit, trustLevel: "unverified" }], diagnostics: { searchMode: "future" } });
    expect(result.results[0].trustLevel).toBe("unverified");
    expect(result.diagnostics).toEqual({ searchMode: "future" });
  });

  it("accepts incomplete hits for existing read-only consumers", () => {
    const result = normalizeRagSearchResult({ results: [{ id: "1" }] });
    expect(result.results[0].id).toBe("1");
    expect(result.results[0].text).toBeUndefined();
    expect(result.results[0].textSha256).toBeUndefined();
    expect(result.diagnostics).toBeUndefined();
  });

  it("accepts explicitly empty results without inferring retrieval health", () => {
    expect(normalizeRagSearchResult([]).results).toEqual([]);
    expect(normalizeRagSearchResult({ results: [] }).diagnostics).toBeUndefined();
  });

  it("verifies a supplied text digest and emits the canonical digest", () => {
    const result = normalizeRagSearchResult([{ ...hit, textSha256: textSha256.toUpperCase() }]);
    expect(result.results[0].textSha256).toBe(textSha256);
  });

  it("preserves consistent top-level diagnostics and merges complementary fields", () => {
    expect(normalizeRagSearchResult({
      results: [],
      degraded: false,
      searchMode: "bm25",
      evidenceRequirement: "live-runtime",
      diagnostics: { degraded: false, candidateCount: 0 },
    }).diagnostics).toEqual({ degraded: false, searchMode: "bm25", evidenceRequirement: "live-runtime", candidateCount: 0 });
  });

  it.each([
    ["null envelope", null],
    ["primitive envelope", "broken"],
    ["missing results", {}],
    ["null results", { results: null }],
    ["object results", { results: {} }],
    ["null hit", { results: [null] }],
    ["array hit", { results: [[]] }],
    ["primitive hit", { results: ["broken"] }],
    ["upstream error", { results: [], error: "unavailable" }],
    ["invalid query", { query: 3, results: [] }],
    ["invalid id", [{ id: 2 }]],
    ["invalid title", [{ title: {} }]],
    ["invalid section", [{ section: [] }]],
    ["invalid text", [{ text: null }]],
    ["empty text", [{ text: " \n " }]],
    ["invalid source", [{ source: false }]],
    ["invalid fallback path", [{ source: "https://example.com", filePath: false }]],
    ["invalid product", [{ product: 2 }]],
    ["invalid version", [{ version: {} }]],
    ["invalid trust", [{ trustLevel: true }]],
    ["invalid source type", [{ sourceType: [] }]],
    ["invalid visibility type", [{ sourceVisibility: true }]],
    ["null visibility", [{ sourceVisibility: null }]],
    ["empty visibility", [{ sourceVisibility: "" }]],
    ["unknown visibility enum", [{ sourceVisibility: "future" }]],
    ["string sharing permission", [{ customerShareable: "true" }]],
    ["null sharing permission", [{ customerShareable: null }]],
    ["numeric sharing permission", [{ customerShareable: 1 }]],
    ["nonfinite score", [{ score: Number.NaN }]],
    ["invalid rerank score", [{ rerankScore: "2" }]],
    ["invalid retrieval mode", [{ retrievalMode: false }]],
    ["invalid digest", [{ ...hit, textSha256: "not-a-digest" }]],
    ["mismatched digest", [{ ...hit, textSha256: "0".repeat(64) }]],
    ["digest without text", [{ textSha256 }]],
    ["null diagnostics", { results: [], diagnostics: null }],
    ["array diagnostics", { results: [], diagnostics: [] }],
    ["invalid health", { results: [], diagnostics: { degraded: "false" } }],
    ["invalid search mode", { results: [], diagnostics: { searchMode: false } }],
    ["invalid evidence requirement", { results: [], diagnostics: { evidenceRequirement: [] } }],
    ["invalid nested diagnostic", { results: [], diagnostics: { candidateCount: Infinity } }],
    ["conflicting health", { results: [], degraded: false, diagnostics: { degraded: true } }],
    ["conflicting mode", { results: [], searchMode: "semantic", diagnostics: { searchMode: "hash" } }],
    ["conflicting evidence requirement", { results: [], evidenceRequirement: "live-runtime", diagnostics: { evidenceRequirement: "other" } }],
  ])("rejects %s explicitly", (_name, raw) => {
    expect(() => normalizeRagSearchResult(raw)).toThrow("Invalid engineer RAG response");
  });

  it("accepts exact bounds without changing the text", () => {
    const fullText = "x".repeat(12_000);
    const result = normalizeRagSearchResult(Array.from({ length: 20 }, () => ({ text: fullText })));
    expect(result.results).toHaveLength(20);
    expect(result.results[0].text).toBe(fullText);
    expect(result.results[0].textSha256).toBe(createHash("sha256").update(fullText).digest("hex"));
  });

  it.each([
    ["too many results", Array.from({ length: 21 }, () => hit)],
    ["oversized text", [{ text: "x".repeat(12_001) }]],
    ["oversized source", [{ source: "x".repeat(2_049) }]],
    ["oversized title", [{ title: "x".repeat(1_001) }]],
    ["oversized query", { query: "x".repeat(8_001), results: [] }],
    ["oversized diagnostics", { results: [], diagnostics: { messages: Array.from({ length: 10 }, () => "x".repeat(2_000)) } }],
    ["deep diagnostics", { results: [], diagnostics: { a: { b: { c: { d: { e: { f: { g: true } } } } } } } }],
    ["oversized diagnostic array", { results: [], diagnostics: { messages: Array.from({ length: 101 }, () => "x") } }],
  ])("rejects %s rather than silently truncating", (_name, raw) => {
    expect(() => normalizeRagSearchResult(raw)).toThrow("Invalid engineer RAG response");
  });
});
