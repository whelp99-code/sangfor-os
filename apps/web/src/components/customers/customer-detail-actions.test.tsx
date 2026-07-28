import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./customer-detail-actions.tsx", import.meta.url), "utf8");

describe("CustomerDetailActions CAS/idempotency boundary", () => {
  it("sends PATCH {expectedUpdatedAt,changes} and DELETE {expectedUpdatedAt}", () => {
    expect(source).toMatch(/method:\s*["']PATCH["']/);
    expect(source).toMatch(/JSON\.stringify\(\{[\s\S]*expectedUpdatedAt,\s*changes/);
    expect(source).toMatch(/method:\s*["']DELETE["']/);
    expect(source).toMatch(/JSON\.stringify\(\{[\s\S]*expectedUpdatedAt\s*\}\)/);
  });

  it("uses a fresh bounded Idempotency-Key and never emits authority fields", () => {
    expect((source.match(/crypto\.randomUUID\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/["']Idempotency-Key["']/i);
    expect(source).not.toMatch(/\bprojectSlug\b|\btenantId\b|\bcompanyId\b|\bprojectId\b|\bactor\b|\bassignmentId\b|\brole\b/);
  });

  it("hides all mutation controls for read-only users", () => {
    expect(source).toMatch(/if\s*\(\s*!canWrite\s*\)\s*return\s+null/);
  });
});
