import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MailCandidateMetadata,
  RevalidationFallbackNotice,
  getRevalidationDecisionLabel,
  getRevalidationFallbackMessage,
  getRevalidationModeLabel,
  getVisibleMailCandidateMetadataEntries,
} from "./revalidation-fallback-notice";

describe("RevalidationFallbackNotice render", () => {
  it("renders the explicit Korean fallback reason as a status", () => {
    const html = renderToStaticMarkup(
      createElement(RevalidationFallbackNotice, {
        reason: "AI 재검증 응답 시간이 초과되어 규칙 기반 검토로 대체했습니다.",
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("AI 재검증 대체 실행");
    expect(html).toContain("규칙 기반 검토로 대체했습니다.");
  });

  it("renders nothing without a fallback reason", () => {
    expect(
      renderToStaticMarkup(createElement(RevalidationFallbackNotice, { reason: undefined })),
    ).toBe("");
  });

  it("maps legacy raw timeout values without exposing upstream text", () => {
    const message = getRevalidationFallbackMessage("openai_timeout");
    expect(message).toBe("AI 재검증 응답 시간이 초과되어 규칙 기반 검토로 대체했습니다.");
    expect(message).not.toContain("openai_timeout");
  });

  it("maps unknown raw upstream values to a generic safe message", () => {
    const message = getRevalidationFallbackMessage("vendor socket failure at private-host:443");
    expect(message).toBe("AI 재검증 서비스를 사용할 수 없어 규칙 기반 검토로 대체했습니다.");
    expect(message).not.toContain("private-host");
  });

  it("never passes through a message shaped like a localized fallback", () => {
    const message = getRevalidationFallbackMessage(
      "AI 재검증 vendor-secret=abc를 확인할 수 없어 대체했습니다.",
    );
    expect(message).toBe("AI 재검증 서비스를 사용할 수 없어 규칙 기반 검토로 대체했습니다.");
    expect(message).not.toContain("vendor-secret");
  });

  it("maps revalidation decision and mode enums to Korean labels", () => {
    expect(getRevalidationDecisionLabel("needs_human_review")).toBe("사람 검토 필요");
    expect(getRevalidationDecisionLabel("approve_candidate")).toBe("승인 후보");
    expect(getRevalidationModeLabel("template")).toBe("규칙 기반 대체");
    expect(getRevalidationModeLabel("llm")).toBe("AI 모델");
  });

  it("excludes metadata already rendered by dedicated sections", () => {
    const entries = getVisibleMailCandidateMetadataEntries({
      aiRevalidation: { fallbackReason: "openai_timeout" },
      mailIntelligence: { summary: "dedicated" },
      policyDecision: { decision: "candidate" },
      messageId: "message-1",
    });
    expect(entries).toEqual([{ key: "messageId", value: "message-1" }]);
    expect(JSON.stringify(entries)).not.toContain("openai_timeout");
  });

  it("renders an explicit Korean empty state when only dedicated metadata exists", () => {
    const html = renderToStaticMarkup(
      createElement(MailCandidateMetadata, {
        metadata: { aiRevalidation: { fallbackReason: "openai_timeout" } },
      }),
    );
    expect(html).toContain("표시할 추가 메타데이터가 없습니다.");
    expect(html).not.toContain("openai_timeout");
  });
});
