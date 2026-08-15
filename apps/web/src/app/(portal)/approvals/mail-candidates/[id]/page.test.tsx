import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("/approvals/mail-candidates/[id] scoped detail adapter", () => {
  it("uses the persisted session and scoped business read instead of raw Prisma", () => {
    expect(source).toContain("evaluatePersistedSessionFromRequest");
    expect(source).toContain("resolveCrmAuthContext");
    expect(source).toMatch(
      /getScopedMailDerivedCandidate\s*\(\s*(?:ctx|context)\s*,\s*id\s*\)/u,
    );
    expect(source).not.toMatch(/mailDerivedCandidate\.findUnique/u);
  });

  it("keeps existing human-gated actions in the detail surface", () => {
    expect(source).toContain("MailCandidateActions");
    expect(source).toContain("ApproveConnectForm");
    expect(source).toContain("CandidateTypeToggle");
  });
});
