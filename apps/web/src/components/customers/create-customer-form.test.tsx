import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./create-customer-form.tsx", import.meta.url), "utf8");

describe("CreateCustomerForm public command boundary", () => {
  it("sends a fresh bounded idempotency key and no caller-selected scope", () => {
    expect(source).toMatch(/["']Idempotency-Key["']/i);
    expect(source).toMatch(/crypto\.randomUUID\(\)/);
    expect(source).not.toContain("useDefaultProject");
    expect(source).not.toContain("projectSlug");
    expect(source).not.toMatch(/\btenantId\b|\bcompanyId\b|\bprojectId\b|\bactor\b|\bassignmentId\b|\brole\b/);
  });

  it("renders only one form surface", () => {
    expect((source.match(/<form\b/g) ?? [])).toHaveLength(1);
  });
});
