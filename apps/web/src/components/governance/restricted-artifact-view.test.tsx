import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RestrictedArtifactView } from "./restricted-artifact-view";

describe("RestrictedArtifactView", () => {
  it("renders restricted badge and watermark", () => {
    const html = renderToStaticMarkup(
      createElement(RestrictedArtifactView, {
        artifactId: "art1",
        artifactVersionId: "av1",
        classification: "restricted",
        watermark: { identityLabel: "User A", companyLabel: "Acme", requestId: "req1", renderedAt: "2026-07-25T00:00:00Z" },
      }),
    );
    expect(html).toContain("RESTRICTED");
    expect(html).toContain("restricted-artifact-view");
    expect(html).toContain("watermark-overlay");
  });

  it("shows redaction notice when paths given", () => {
    const html = renderToStaticMarkup(
      createElement(RestrictedArtifactView, {
        artifactId: "art1",
        artifactVersionId: "av1",
        classification: "restricted",
        redactedFieldPaths: ["price", "discount"],
      }),
    );
    expect(html).toContain("redaction-notice");
    expect(html).toContain("price");
  });
});
