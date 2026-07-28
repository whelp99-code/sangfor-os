import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QualificationCard } from "./qualification-card";

describe("QualificationCard Component Render Tests", () => {
  const sampleQualification = {
    id: "qual-1",
    budgetScore: 15,
    authorityScore: 15,
    needScore: 20,
    timelineScore: 12,
    technicalFitScore: 18,
    scoreTotal: 80,
    passed: true,
    scoringVersion: "bant-tf-v1",
    revision: 3,
    assessedAt: "2026-07-24T10:00:00.000Z",
    notes: "High fit customer",
  };

  it("renders 5 component scores with max limits, total score, scoringVersion, revision, assessor time, and pass status", () => {
    const html = renderToStaticMarkup(
      createElement(QualificationCard, {
        opportunityId: "opp-1",
        qualification: sampleQualification,
        readOnly: false,
      }),
    );

    expect(html).toContain("BANT + Technical Fit 자격 평가");
    expect(html).toContain("QUALIFIED (통과)");

    expect(html).toContain("15 / 20");
    expect(html).toContain("20 / 24");
    expect(html).toContain("12 / 16");
    expect(html).toContain("18 / 20");

    expect(html).toContain("총점: 80 / 100");
    expect(html).toContain("버전: bant-tf-v1");
    expect(html).toContain("Revision: 3");
    expect(html).toContain("평가시각:");

    expect(html).toContain("평가 수정");
  });

  it("renders unpassed status and legacy revision warning when qualification is stale", () => {
    const legacyQualification = {
      ...sampleQualification,
      scoringVersion: "bant-v0",
      passed: true,
      scoreTotal: 70,
    };

    const html = renderToStaticMarkup(
      createElement(QualificationCard, {
        opportunityId: "opp-1",
        qualification: legacyQualification,
        readOnly: false,
      }),
    );

    expect(html).toContain("NEEDS DISCOVERY (미통과)");
    expect(html).toContain("레거시 revision (재평가 필요)");
    expect(html).toContain("버전: bant-v0");
  });

  it("omits edit button when readOnly=true (Viewer mode)", () => {
    const html = renderToStaticMarkup(
      createElement(QualificationCard, {
        opportunityId: "opp-1",
        qualification: sampleQualification,
        readOnly: true,
      }),
    );

    expect(html).not.toContain("평가 수정");
  });
});
