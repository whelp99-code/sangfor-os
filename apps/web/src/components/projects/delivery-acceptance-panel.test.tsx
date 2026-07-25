import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliveryAcceptancePanel } from "./delivery-acceptance-panel";

describe("DeliveryAcceptancePanel Render Tests", () => {
  it("renders delivery acceptance info and status", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryAcceptancePanel, {
        engagementId: "eng1",
        quoteId: "q1",
        artifactVersionId: "av1",
        acceptanceId: "acc1",
        acceptedAt: "2026-07-25T12:00:00Z",
      }),
    );

    expect(html).toContain("Atomic Delivery Acceptance");
    expect(html).toContain("Accepted ID: acc1");
    expect(html).toContain("Quote ID: q1");
    expect(html).toContain("Artifact Version: av1");
  });
});
