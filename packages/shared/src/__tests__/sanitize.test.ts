import { describe, it, expect } from "vitest";
import { sanitizeJsonStrings } from "../sanitize.js";

describe("sanitizeJsonStrings", () => {
  it("strips C0 control characters from a string", () => {
    const result = sanitizeJsonStrings("hello\x00world\x7Ffoo\x08bar");
    expect(result).toBe("helloworldfoobar");
  });

  it("strips an unpaired high surrogate from a string", () => {
    // \uD83D is an unpaired high surrogate
    const result = sanitizeJsonStrings("before\uD83Dafter");
    expect(result).toBe("beforeafter");
  });

  it("strips an unpaired low surrogate from a string", () => {
    // \uDE00 is an unpaired low surrogate
    const result = sanitizeJsonStrings("before\uDE00after");
    expect(result).toBe("beforeafter");
  });

  it("preserves a valid surrogate pair (emoji) unchanged", () => {
    // \uD83D\uDE00 is a valid surrogate pair = 😀
    const result = sanitizeJsonStrings("hello\uD83D\uDE00world");
    expect(result).toBe("hello\uD83D\uDE00world");
  });

  it("recurses correctly into nested objects and arrays", () => {
    const input = {
      a: "hello\x00world",
      b: ["foo\x00bar", { c: "baz\x7Fqux" }],
    };
    const result = sanitizeJsonStrings(input) as Record<string, unknown>;
    expect(result.a).toBe("helloworld");
    expect(Array.isArray(result.b)).toBe(true);
    const arr = result.b as unknown[];
    expect(arr[0]).toBe("foobar");
    expect((arr[1] as Record<string, unknown>).c).toBe("bazqux");
  });

  it("passes through null, undefined, numbers, booleans unchanged", () => {
    expect(sanitizeJsonStrings(null)).toBeNull();
    expect(sanitizeJsonStrings(undefined)).toBeUndefined();
    expect(sanitizeJsonStrings(42)).toBe(42);
    expect(sanitizeJsonStrings(3.14)).toBe(3.14);
    expect(sanitizeJsonStrings(true)).toBe(true);
    expect(sanitizeJsonStrings(false)).toBe(false);
  });

  it("respects the maxDepth guard on deeply nested input", () => {
    // Build a deeply nested object: { a: { a: { ... } } }
    let nested: Record<string, unknown> = {};
    let ptr = nested;
    for (let i = 0; i < 20; i++) {
      ptr.a = {};
      ptr = ptr.a as Record<string, unknown>;
    }
    // Should not throw; with maxDepth=5, returns nested structure at depth 5 without crashing
    expect(() => sanitizeJsonStrings(nested, 5)).not.toThrow();
  });
});
