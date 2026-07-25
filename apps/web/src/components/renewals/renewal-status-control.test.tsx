import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RenewalStatusControl } from "./renewal-status-control";

describe("RenewalStatusControl Render Tests", () => {
  it("renders status control component and advance buttons", () => {
    const html = renderToStaticMarkup(
      createElement(RenewalStatusControl, {
        renewalOpportunityId: "ren1",
        status: "pending",
        updatedAt: "2026-07-25T12:00:00Z",
      }),
    );

    expect(html).toContain("Renewal Lifecycle Control");
    expect(html).toContain("pending");
    expect(html).toContain("Advance to notified");
    expect(html).toContain("Mark Lost");
  });
});
