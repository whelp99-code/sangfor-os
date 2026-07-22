import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ToastProvider } from "@/components/ui/toast";
import { SlipActions } from "./slip-actions";

describe("SlipActions render", () => {
  it("throws without a ToastProvider ancestor (useToast contract)", () => {
    expect(() =>
      renderToStaticMarkup(createElement(SlipActions, { candidateId: "cand-1" })),
    ).toThrow(/ToastProvider/);
  });

  it("renders approve/reject/detail controls under ToastProvider", () => {
    const html = renderToStaticMarkup(
      createElement(
        ToastProvider,
        null,
        createElement(SlipActions, {
          candidateId: "cand-1",
          detailHref: "/approvals/mail-candidates/cand-1",
        }),
      ),
    );
    expect(html).toContain("승인 · 전환");
    expect(html).toContain("거부");
    expect(html).toContain("상세");
    expect(html).toContain("엔티티 역할 오류");
  });

  it("renders the AI 재검증 필요 nudge when needsAiRevalidation is true", () => {
    const html = renderToStaticMarkup(
      createElement(
        ToastProvider,
        null,
        createElement(SlipActions, { candidateId: "cand-1", needsAiRevalidation: true }),
      ),
    );
    expect(html).toContain("AI 재검증 필요");
  });

  it("omits the nudge when needsAiRevalidation is not set", () => {
    const html = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement(SlipActions, { candidateId: "cand-1" })),
    );
    expect(html).not.toContain("AI 재검증 필요");
  });
});
