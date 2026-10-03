import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSupportReplyDraft, isSafeSangforDocumentLink, supportReplyRequestSchema, unavailableSupportReplyDraft, type SupportReplyEvidenceHit, type SupportReplyRequest, type SupportReplySearch } from "./support-reply-draft";

// Synthetic contract fixtures. These URLs and version labels are not vendor claims.
const request: SupportReplyRequest = { topic: "kernel_patch", query: "Synthetic patch question", product: "HCI", version: "fixture-1" };
const text = "Synthetic fixture: confirm the exact build before considering a patch.";
const hit: SupportReplyEvidenceHit = { id: "fixture-chunk", title: "Synthetic fixture manual", text,
  source: "https://support.sangfor.com/synthetic-fixture", product: "HCI", version: "fixture-1", trustLevel: "official", sourceVisibility: "public", customerShareable: true,
  textSha256: createHash("sha256").update(text).digest("hex") };
function search(hits: SupportReplyEvidenceHit[] = [{ ...hit }]): SupportReplySearch {
  return { results: hits, diagnostics: { degraded: false, searchMode: "bm25" } };
}

describe("support reply evidence contract", () => {
  it("returns an exact attributed extract and never an approved or sendable result", () => {
    const out = buildSupportReplyDraft(request, search());
    expect(out.status).toBe("draft");
    expect(out.citations).toEqual([{ chunkId: hit.id, title: hit.title, source: hit.source, product: hit.product,
      version: hit.version, quote: text, quoteStart: 0, textSha256: hit.textSha256 }]);
    expect(out.draftText).toContain(text);
    expect(out.draftText).toContain(hit.source);
    expect(out).toMatchObject({ humanReviewRequired: true, customerSendAllowed: false });
    expect(out.warnings.join(" ")).toContain("의미적 관련성");
  });

  it.each([undefined, { degraded: true, searchMode: "semantic" }, { searchMode: "semantic" },
    { degraded: false, searchMode: "hash" }, { degraded: false, searchMode: "unknown" }])(
    "does not promote missing, legacy, degraded or hash diagnostics: %j", diagnostics => {
      expect(buildSupportReplyDraft(request, { results: [hit], diagnostics }).status).toBe("needs_evidence");
    });

  it("returns a runtime-evidence requirement instead of a public-document answer", () => {
    const out = buildSupportReplyDraft(request, { ...search(), diagnostics: { degraded: false, searchMode: "semantic", evidenceRequirement: "live-runtime" } });
    expect(out.status).toBe("needs_evidence");
    expect(out.draftText).toBeNull();
  });

  it.each(["id", "title", "text", "source", "product", "version", "trustLevel", "textSha256", "sourceVisibility", "customerShareable"] as const)(
    "does not draft from incomplete evidence: %s", key => {
      const incomplete = { ...hit, [key]: undefined };
      const out = buildSupportReplyDraft(request, search([incomplete]));
      expect(out.status).not.toBe("draft");
      expect(out.citations).toEqual([]);
    });

  it.each([{ product: "IAG" }, { version: "fixture-2" }, { trustLevel: "draft" }, { trustLevel: "internal" }, { sourceVisibility: "internal" }, { customerShareable: false },
    { source: "/private/manual.md" }, { source: "https://sangfor.com.evil.invalid/doc" }])(
    "rejects inapplicable or unretrievable evidence: %j", override => {
      expect(buildSupportReplyDraft(request, search([{ ...hit, ...override }])).status).toBe("needs_evidence");
    });

  it("rejects changed text and detects a duplicate chunk with contradictory bytes", () => {
    expect(buildSupportReplyDraft(request, search([{ ...hit, text: "Changed bytes" }])).status).toBe("conflict");
    const changed = "Another synthetic source body";
    const out = buildSupportReplyDraft(request, search([hit, { ...hit, text: changed, textSha256: createHash("sha256").update(changed).digest("hex") }]));
    expect(out.status).toBe("conflict");
    expect(out.citations).toEqual([]);
  });

  it.each([
    { sourceVisibility: "restricted" }, { customerShareable: false },
    { trustLevel: "internal" }, { version: "fixture-2" },
  ])("fails closed on contradictory duplicate provenance before eligibility filtering: %j", override => {
    for (const hits of [[hit, { ...hit, ...override }], [{ ...hit, ...override }, hit]]) {
      expect(buildSupportReplyDraft(request, search(hits))).toMatchObject({ status: "conflict", draftText: null, citations: [] });
    }
  });

  it.each([
    "https://SUPPORT.SANGFOR.COM/synthetic-fixture",
    "https://support.sangfor.com:443/synthetic-fixture",
    "https://support.sangfor.com/unused/../synthetic-fixture",
  ])("detects conflicting chunks behind equivalent canonical source URLs: %s", source => {
    const changed = "Different synthetic evidence bytes";
    const duplicate = { ...hit, source, text: changed,
      textSha256: createHash("sha256").update(changed).digest("hex") };
    expect(buildSupportReplyDraft(request, search([hit, duplicate]))).toMatchObject({ status: "conflict", draftText: null, citations: [] });
  });

  it("deduplicates equivalent canonical source URLs with identical evidence", () => {
    const duplicate = { ...hit, source: "https://SUPPORT.SANGFOR.COM/synthetic-fixture" };
    const out = buildSupportReplyDraft(request, search([duplicate, hit]));
    expect(out.status).toBe("draft");
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].source).toBe(hit.source);
  });

  it("deduplicates identical evidence and bounds an exact excerpt", () => {
    const longText = "Synthetic excerpt. ".repeat(70);
    const long = { ...hit, text: longText, textSha256: createHash("sha256").update(longText).digest("hex") };
    const out = buildSupportReplyDraft(request, search([long, long]));
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].quote).toBe(longText.slice(0, 800));
  });

  it.each(["넥시아스", "Nexias", "contact@example.test", "password=synthetic-secret"])(
    "does not copy intermediary/contact/credential-like strings into a reply: %s", marker => {
      const privateText = `Synthetic ${marker}`;
      const out = buildSupportReplyDraft(request, search([{ ...hit, text: privateText, textSha256: createHash("sha256").update(privateText).digest("hex") }]));
      expect(out.status).toBe("needs_evidence");
      expect(out.draftText).toBeNull();
      expect(JSON.stringify(out)).not.toContain(marker);
    });

  it("does not invent renewal prices, dates or term commitments from manuals", () => {
    const out = buildSupportReplyDraft({ ...request, topic: "renewal" }, search());
    expect(out.status).toBe("needs_evidence");
    expect(out.draftText).toContain("최신 견적·계약");
    expect(out.citations).toEqual([]);
    expect(out.draftText).not.toMatch(/\d|완료|발급했/);
  });

  it("does not assert service-letter issuance or delivery", () => {
    const out = buildSupportReplyDraft({ ...request, topic: "service_letter" }, search());
    expect(out.status).toBe("needs_evidence");
    expect(out.draftText).toContain("원본 자료");
    expect(out.draftText).not.toMatch(/완료|발급했|전달했/);
  });

  it("asks for version and patch identity instead of guessing compatibility", () => {
    const out = buildSupportReplyDraft({ ...request, version: undefined }, search());
    expect(out.status).toBe("needs_evidence");
    expect(out.draftText).toContain("패치 식별정보");
    expect(out.citations).toEqual([]);
  });

  it("distinguishes service failure from no results", () => {
    expect(unavailableSupportReplyDraft()).toMatchObject({ status: "service_unavailable", draftText: null, citations: [], customerSendAllowed: false });
    expect(buildSupportReplyDraft(request, search([])).status).toBe("needs_evidence");
  });

  it.each(["javascript:alert(1)", "http://support.sangfor.com/doc", "https://user:pass@sangfor.com/doc", "https://sangfor.com:444/doc", "https://sangfor.com.evil.invalid/doc", "file:///tmp/manual",
    "https://one.sangfor.com/ml/portal", "https://support.sangfor.com/doc?access_token=synthetic-secret&partner=Nexias&contact=private@example.test",
    "https://support.sangfor.com/doc#private@example.test", "https://support.sangfor.com/doc?", "https://support.sangfor.com/doc#",
    "https://support.sangfor.com/Nexias/manual", "https://support.sangfor.com/%70rivate%40example.test/manual"])(
    "does not accept unsafe source links: %s", source => expect(isSafeSangforDocumentLink(source)).toBe(false));

  it("never treats official partner-portal content as public customer evidence", () => {
    const out = buildSupportReplyDraft(request, search([{ ...hit, source: "https://one.sangfor.com/ml/portal" }]));
    expect(out).toMatchObject({ status: "needs_evidence", draftText: null, citations: [] });
  });

  it.each(["id", "section", "product", "version"] as const)("checks copied metadata field %s for private content", field => {
    const out = buildSupportReplyDraft({ ...request, ...(field === "product" || field === "version" ? { [field]: "Nexias" } : {}) }, search([{ ...hit, [field]: "Nexias" }]));
    expect(out.status).toBe("needs_evidence");
    expect(JSON.stringify(out)).not.toContain("Nexias");
  });

  it("rejects extra scope/authority keys and invalid or oversized inputs", () => {
    expect(supportReplyRequestSchema.safeParse({ ...request, projectId: "foreign" }).success).toBe(false);
    expect(supportReplyRequestSchema.safeParse({ ...request, query: "" }).success).toBe(false);
    expect(supportReplyRequestSchema.safeParse({ ...request, query: "x".repeat(2_001) }).success).toBe(false);
  });
});
