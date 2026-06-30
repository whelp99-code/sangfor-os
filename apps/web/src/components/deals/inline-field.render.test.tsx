import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Mock next/navigation so useRouter doesn't throw in SSR test context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { InlineField } from "./inline-field";

// ---------------------------------------------------------------------------
// Static-render tests for InlineField (no jsdom required).
// Edit-mode toggle (client-side state) is not testable via SSR render;
// we verify the VIEW-mode HTML contract here.
// ---------------------------------------------------------------------------
describe("InlineField render", () => {
  const baseProps = {
    label: "딜명",
    value: "테스트 딜",
    opportunityId: "opp-001",
  };

  it("renders label and value in view mode", () => {
    const html = renderToStaticMarkup(createElement(InlineField, baseProps));
    expect(html).toContain("딜명");
    expect(html).toContain("테스트 딜");
  });

  it("readOnly field shows 자동 marker", () => {
    const html = renderToStaticMarkup(
      createElement(InlineField, {
        ...baseProps,
        label: "예상 마진",
        value: "—",
        readOnly: true,
      }),
    );
    expect(html).toContain("자동");
    expect(html).toContain("예상 마진");
  });

  it("readOnly field does NOT render an edit affordance (no cursor-text class)", () => {
    const html = renderToStaticMarkup(
      createElement(InlineField, {
        ...baseProps,
        readOnly: true,
      }),
    );
    // cursor-text is only added when canEdit is true (editable && !readOnly && field present)
    expect(html).not.toContain("cursor-text");
  });

  it("editable field includes an aria-label for edit interaction", () => {
    const html = renderToStaticMarkup(
      createElement(InlineField, {
        ...baseProps,
        field: "title",
        rawValue: "테스트 딜",
      }),
    );
    // Should have an aria-label indicating edit affordance
    expect(html).toContain("딜명 편집");
  });

  it("non-editable field (editable=false) has no aria-label for edit", () => {
    const html = renderToStaticMarkup(
      createElement(InlineField, {
        ...baseProps,
        editable: false,
      }),
    );
    expect(html).not.toContain("편집");
  });

  it("renders — for null value", () => {
    const html = renderToStaticMarkup(
      createElement(InlineField, {
        ...baseProps,
        value: null,
      }),
    );
    expect(html).toContain("—");
  });

  it("select field renders current value without opening editor", () => {
    const html = renderToStaticMarkup(
      createElement(InlineField, {
        label: "상태",
        value: "진행",
        field: "dealStatus",
        inputType: "select",
        options: [
          { value: "OPEN", label: "진행" },
          { value: "LOST", label: "실패" },
        ],
        opportunityId: "opp-001",
        rawValue: "OPEN",
      }),
    );
    expect(html).toContain("상태");
    expect(html).toContain("진행");
  });
});
