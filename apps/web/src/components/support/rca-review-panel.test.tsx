import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RcaReviewPanel } from "./rca-review-panel";

describe("RcaReviewPanel", () => {
  it("renders RCA review status panel", () => {
    const html = renderToStaticMarkup(
      createElement(RcaReviewPanel, {
        supportCaseId: "sc1",
        status: "resolved",
        revision: 2,
        qualityPassed: false,
        assessmentStatus: "pending",
      }),
    );
    expect(html).toContain("rca-review-panel");
    expect(html).toContain("close-blocked");
  });

  it("shows close button only when full chain complete", () => {
    const html = renderToStaticMarkup(
      createElement(RcaReviewPanel, {
        supportCaseId: "sc1",
        status: "resolved",
        revision: 2,
        qualityPassed: true,
        assessmentStatus: "completed",
        leadReviewDecision: "approved",
        archReviewDecision: "approved",
        approvalStatus: "approved",
      }),
    );
    expect(html).toContain("btn-close-case");
  });
});
