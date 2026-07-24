import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("/customers/[id] scoped detail adapter", () => {
  it("uses one canonical complete read model and no page-level Prisma read", () => {
    expect(source).toContain("resolveCrmAuthContext");
    expect(source).toMatch(/getCustomerDetail\s*\(\s*(?:ctx|context)\s*,\s*id\s*\)/);
    expect(source).not.toContain("@sangfor/db");
    expect(source).not.toMatch(/\bprisma\./);
    expect(source).not.toMatch(/customerAsset\.find|renewalOpportunity\.find|supportCase\.find/);
  });

  it("uses the customer-specific CAS/idempotency actions while retaining contact actions", () => {
    expect(source).toContain("CustomerDetailActions");
    expect(source).not.toMatch(/EntityEditSheet[\s\S]{0,500}endpoint=\{`\/api\/customers/);
    expect(source).not.toMatch(/DeleteEntityButton[\s\S]{0,300}\/api\/customers/);
    expect(source).toContain("CreateContactForm");
  });
});
