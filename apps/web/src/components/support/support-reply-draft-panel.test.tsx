import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SupportReplyDraftPanel, SupportReplyDraftResult } from "./support-reply-draft-panel";
import { supportReplyPreviewSchema } from "./support-reply-preview";
import type { SupportReplyDraft } from "@sangfor/business";

const preview: SupportReplyDraft = { status: "needs_evidence", draftText: "추가 자료를 공유 부탁드립니다.", citations: [],
  missingFacts: ["정확한 제품 버전"], warnings: ["검토용 초안"], humanReviewRequired: true, customerSendAllowed: false };

describe("support reply preview", () => {
  it("renders an explicit draft-only form with no send or apply action", () => {
    const html = renderToStaticMarkup(createElement(SupportReplyDraftPanel, { supportCaseId: "synthetic-case" }));
    expect(html).toContain("출처 기반 답장 초안");
    expect(html).toContain("검토용 초안 만들기");
    expect(html).toContain("고객명·장비 식별정보를 제외");
    expect(html).toContain("disabled");
    expect(html).not.toMatch(/<button[^>]*>.*(?:발송|적용|승인)/);
  });
  it("shows missing evidence and a read-only clarification draft", () => {
    const html = renderToStaticMarkup(createElement(SupportReplyDraftResult, { draft: preview }));
    expect(html).toContain("추가 근거 필요");
    expect(html).toContain("정확한 제품 버전");
    expect(html).toContain("readOnly");
    expect(html).toContain("추가 자료를 공유 부탁드립니다.");
  });
  it.each(["toString", "approved", "__proto__"])("rejects unexpected status %s", status => {
    expect(supportReplyPreviewSchema.safeParse({ ...preview, status }).success).toBe(false);
  });
  it("rejects forged authority and malformed arrays before render", () => {
    expect(supportReplyPreviewSchema.safeParse({ ...preview, customerSendAllowed: true }).success).toBe(false);
    expect(supportReplyPreviewSchema.safeParse({ ...preview, missingFacts: [{}] }).success).toBe(false);
  });
  it.each(["javascript:alert(1)", "https://user:secret@sangfor.com/doc", "https://sangfor.com.evil.invalid/doc", "https://one.sangfor.com/ml/portal", "https://support.sangfor.com/doc?access_token=synthetic", "https://support.sangfor.com/doc#private@example.test", "https://support.sangfor.com/doc?", "https://support.sangfor.com/doc#"])(
    "rejects unsafe citation URL %s", source => {
      const citation = { chunkId: "fixture", source, title: "Fixture", product: "HCI", quote: "Fixture", quoteStart: 0, textSha256: "a".repeat(64) };
      expect(supportReplyPreviewSchema.safeParse({ ...preview, citations: [citation] }).success).toBe(false);
    });
});
