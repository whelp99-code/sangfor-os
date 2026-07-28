import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QuoteEditor, type QuoteEditorProps } from "./quote-editor";

const baseProps: QuoteEditorProps = {
  quoteId: "quote-abc12345",
  version: 1,
  status: "draft",
  currency: "KRW",
  contentHash: "a".repeat(64),
  lines: [
    {
      id: "line-1",
      lineType: "product",
      description: "HCI Appliance",
      quantity: 2,
      unitPrice: "5000000",
      discountPct: "5",
      revenue: "9500000",
      cost: "6000000",
      marginPct: "36.8",
      skuCode: "SKU-HCI-001",
      sourceCostStatus: null,
    },
    {
      id: "line-2",
      lineType: "service",
      description: "Implementation",
      quantity: 1,
      unitPrice: "2000000",
      discountPct: "0",
      revenue: "2000000",
      cost: "1000000",
      marginPct: "50.0",
      skuCode: null,
      sourceCostStatus: "confirmed",
    },
  ],
  commercialSnapshot: {
    calculatedRevenue: "11500000",
    calculatedCost: "7000000",
    calculatedMarginPct: "39.1",
    costCoverageStatus: "complete",
    requiresApproval: false,
  },
  approvalStatus: null,
};

describe("QuoteEditor render", () => {
  it("renders quote header with version and status", () => {
    const html = renderToStaticMarkup(createElement(QuoteEditor, baseProps));
    expect(html).toContain("v1");
    expect(html).toContain("초안");
  });

  it("renders line items", () => {
    const html = renderToStaticMarkup(createElement(QuoteEditor, baseProps));
    expect(html).toContain("HCI Appliance");
    expect(html).toContain("Implementation");
    expect(html).toContain("제품");
    expect(html).toContain("서비스");
  });

  it("renders commercial snapshot with cost coverage", () => {
    const html = renderToStaticMarkup(createElement(QuoteEditor, baseProps));
    expect(html).toContain("원가 완전");
    expect(html).toContain("상업 스냅샷");
  });

  it("shows pending U055 release label", () => {
    const html = renderToStaticMarkup(createElement(QuoteEditor, baseProps));
    expect(html).toContain("pending U055");
  });

  it("shows auto_failed cost coverage", () => {
    const html = renderToStaticMarkup(
      createElement(QuoteEditor, {
        ...baseProps,
        commercialSnapshot: {
          ...baseProps.commercialSnapshot!,
          costCoverageStatus: "auto_failed",
          requiresApproval: true,
        },
      }),
    );
    expect(html).toContain("원가 미충족");
    expect(html).toContain("상업 승인 필요");
  });

  it("shows approval status when present", () => {
    const html = renderToStaticMarkup(
      createElement(QuoteEditor, { ...baseProps, approvalStatus: "ready_for_human_approval" }),
    );
    expect(html).toContain("승인 상태");
    expect(html).toContain("ready_for_human_approval");
  });

  it("renders empty state for no lines", () => {
    const html = renderToStaticMarkup(createElement(QuoteEditor, { ...baseProps, lines: [] }));
    expect(html).toContain("라인 아이템이 없습니다");
  });
});
