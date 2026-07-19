import { describe, it, expect, vi, afterEach } from "vitest";
import { HybridMailClassifier } from "./index.js";

describe("HybridMailClassifier rules-only seam", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns exact {result:{category:\"general\"}} for rules-only", async () => {
    const c = new HybridMailClassifier();
    const input = Object.freeze({ id: "m1", subject: "hello" });
    const out = await c.classifyAsync(input, { mode: "rules-only" });
    expect(out).toEqual({ result: { category: "general" } });
    // no confidence field
    expect("confidence" in (out.result as object)).toBe(false);
  });

  it("does not mutate frozen input", async () => {
    const c = new HybridMailClassifier();
    const input = Object.freeze({ id: "m2", nested: Object.freeze({ a: 1 }) });
    const before = JSON.stringify(input);
    await c.classifyAsync(input, { mode: "rules-only" });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("makes zero fetch/LLM network calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const c = new HybridMailClassifier();
    await c.classifyAsync({ id: "m3" }, { mode: "rules-only" });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("does not invent non-general authoritative category", async () => {
    const c = new HybridMailClassifier();
    const out = await c.classifyAsync(
      { subject: "URGENT invoice payment security alert" },
      { mode: "rules-only" },
    );
    expect(out.result.category).toBe("general");
  });
});
