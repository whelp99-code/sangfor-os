import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("/customers scoped adapter", () => {
  it("derives AuthContext and delegates one scoped canonical list read", () => {
    expect(source).toContain("resolveCrmAuthContext");
    expect(source).toMatch(/listCustomersWithOpportunities\s*\(\s*(?:ctx|context)\s*,/);
    expect(source).not.toContain("resolveDefaultProjectSlug");
    expect(source).not.toContain("projectSlug");
    expect(source).not.toContain("@sangfor/db");
  });

  it("passes write capability to the single responsive workspace instead of duplicating DOM", () => {
    expect(source).toMatch(/canWrite=\{[^}]*customer\.write/);
    expect(source).toContain("<CompaniesWorkspace");
    expect((source.match(/<CompaniesWorkspace/g) ?? [])).toHaveLength(1);
  });
});
