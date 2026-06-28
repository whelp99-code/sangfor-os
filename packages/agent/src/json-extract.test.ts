import { describe, expect, it } from "vitest";

import { extractJsonObject } from "./json-extract";

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"action":"final","answer":"hi"}')).toEqual({
      action: "final",
      answer: "hi",
    });
  });

  it("parses JSON inside a ```json fence", () => {
    const raw = 'Sure:\n```json\n{"action":"final","answer":"ok"}\n```';
    expect(extractJsonObject(raw)).toEqual({ action: "final", answer: "ok" });
  });

  it("extracts the first balanced object from surrounding prose", () => {
    const raw = 'Here you go {"action":"tool","tool":"x","arguments":{"q":"a}b"}} done';
    expect(extractJsonObject(raw)).toEqual({
      action: "tool",
      tool: "x",
      arguments: { q: "a}b" },
    });
  });

  it("throws when no JSON object is present", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });
});
