import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdvanceOpportunityButton } from "./advance-button";
import { ConvertToProjectButton } from "./convert-to-project-button";

describe("opportunity action prerequisites", () => {
  it("disables stage advance until BANT qualification passes", () => {
    const html = renderToStaticMarkup(
      createElement(AdvanceOpportunityButton, {
        id: "opportunity-1",
        stage: "LEAD",
        expectedUpdatedAt: "2026-08-13T00:00:00.000Z",
        qualificationPassed: false,
      }),
    );

    expect(html).toContain("disabled");
    expect(html).toContain("BANT 자격검증을 먼저 통과해야 합니다.");
  });

  it("explains every missing project conversion prerequisite", () => {
    const html = renderToStaticMarkup(
      createElement(ConvertToProjectButton, {
        id: "opportunity-1",
        stage: "LEAD",
        expectedUpdatedAt: "2026-08-13T00:00:00.000Z",
        engagementId: null,
        hasPoc: false,
      }),
    );

    expect(html).toContain("disabled");
    expect(html).toContain("제안 이후 단계로 진행하고 PoC를 연결해야 합니다.");
  });
});
