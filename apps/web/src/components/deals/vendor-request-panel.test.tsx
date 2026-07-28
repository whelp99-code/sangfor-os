import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VendorRequestPanel } from "./vendor-request-panel";

describe("VendorRequestPanel Render Tests", () => {
  it("renders vendor requests and action buttons", () => {
    const html = renderToStaticMarkup(
      createElement(VendorRequestPanel, {
        opportunityId: "opp1",
        requests: [
          {
            id: "vreq1",
            requestType: "special_discount",
            status: "ready_for_manual_submission",
            revision: 0,
            ownershipRevision: 0,
            ownerAssignmentId: "ucr1",
            createdAt: "2026-07-25T12:00:00.000Z",
          },
        ],
      }),
    );

    expect(html).toContain("Vendor Requests &amp; Discounts");
    expect(html).toContain("+ Request Special Discount");
    expect(html).toContain("+ Request Demo License");
    expect(html).toContain("special_discount");
    expect(html).toContain("ready_for_manual_submission");
  });
});
