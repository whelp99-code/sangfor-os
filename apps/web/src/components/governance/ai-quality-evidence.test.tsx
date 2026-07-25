import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiQualityEvidence } from "./ai-quality-evidence";

describe("AiQualityEvidence Component Render Tests", () => {
  it("renders quality badge, score, gaps, and 2-of-2 review slots", () => {
    const html = renderToStaticMarkup(
      createElement(AiQualityEvidence, {
        artifactId: "art1",
        artifactVersionId: "av1",
        artifactContentHash: "h1",
        expectedArtifactRevision: 1,
        assessmentId: "asmt1",
        assessmentResultHash: "rh1",
        qualityPassed: true,
        score: 95,
        gaps: ["Missing hardware spec detail"],
        slots: [
          { slotKey: "proposal.presales", businessRole: "presales_engineer", capability: "ai_quality.review", filled: true, decision: "approved" },
          { slotKey: "proposal.cfo", businessRole: "finance_manager", capability: "ai_quality.review", filled: false },
        ],
      }),
    );

    expect(html).toContain("AI Quality Governance");
    expect(html).toContain("PASSED (95pts)");
    expect(html).toContain("Missing hardware spec detail");
    expect(html).toContain("proposal.presales (presales_engineer)");
    expect(html).toContain("✓ approved");
    expect(html).toContain("Pending");
    expect(html).toContain("Approve Slot Review");
    expect(html).toContain("Reject Slot Review");
  });
});
