import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalVersionDiff } from "./approval-version-diff";

describe("ApprovalVersionDiff component", () => {
  it("renders no-diff message when hasDiff is false", () => {
    const html = renderToStaticMarkup(createElement(ApprovalVersionDiff, {
      versionDiff: { kind: "generic", hasDiff: false },
    }));
    expect(html).toContain("No version diff");
  });

  it("renders quote line diffs table when present", () => {
    const html = renderToStaticMarkup(createElement(ApprovalVersionDiff, {
      versionDiff: {
        kind: "quote",
        hasDiff: true,
        quoteLineDiffs: [{ lineId: "l1", field: "unitPrice", oldValue: "100.00", newValue: "90.00" }],
      },
    }));
    expect(html).toContain("quote-version-diff");
    expect(html).toContain("unitPrice");
    expect(html).toContain("100.00");
    expect(html).toContain("90.00");
  });
});
