import { describe, it, expect } from "vitest";

import { caseRefFor } from "./case-ref";

describe("caseRefFor", () => {
  it("matches the existing canonical short prefixes (must not drift)", () => {
    expect(caseRefFor("opportunity", "x")).toBe("opp:x");
    expect(caseRefFor("engagement", "x")).toBe("eng:x");
    expect(caseRefFor("mailCandidate", "x")).toBe("mail_candidate:x");
  });

  it("is stable per entity so a decision row and its correction row pair on one caseRef", () => {
    const id = "abc123";
    // Two independent spine writers for the same entity must produce an identical
    // caseRef, so a single { caseRef } query returns the AI decision + human edit pair.
    expect(caseRefFor("opportunity", id)).toBe(caseRefFor("opportunity", id));
    // Different entities must never collide on the same id.
    expect(caseRefFor("opportunity", id)).not.toBe(caseRefFor("task", id));
  });
});
