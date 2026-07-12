import { describe, it, expect } from "vitest";
import { assembleRagContext } from "./rag-context";

describe("assembleRagContext", () => {
  it("includes only the top maxChunks hits", () => {
    const hits = [
      { title: "a", text: "one", source: "manual-a" },
      { title: "b", text: "two", source: "manual-b" },
      { title: "c", text: "three", source: "manual-c" },
      { title: "d", text: "four", source: "manual-d" },
    ];
    const out = assembleRagContext(hits, { maxChunks: 3 });
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(out).toContain("three");
    expect(out).not.toContain("four");
  });

  it("includes a source label per chunk", () => {
    const out = assembleRagContext([{ title: "a", text: "one", source: "manual-a" }]);
    expect(out).toContain("manual-a");
  });

  it("returns an empty string for an empty array", () => {
    expect(assembleRagContext([])).toBe("");
  });
});
