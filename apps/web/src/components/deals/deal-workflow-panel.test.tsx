import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DealWorkflowPanel } from "./deal-workflow-panel";

describe("DealWorkflowPanel Render Tests", () => {
  it("renders workflow gates and status", () => {
    const html = renderToStaticMarkup(
      createElement(DealWorkflowPanel, {
        opportunityId: "opp1",
        runId: "run1",
        gates: [
          { gateKey: "qualification", eligible: true },
          { gateKey: "poc_requirements", eligible: false, blocker: "POC_REQUIREMENTS_EMPTY" },
        ],
      }),
    );

    expect(html).toContain("Canonical Deal Workflow Gates");
    expect(html).toContain("Run: run1");
    expect(html).toContain("qualification");
    expect(html).toContain("PASSED");
    expect(html).toContain("POC_REQUIREMENTS_EMPTY");
  });
});
