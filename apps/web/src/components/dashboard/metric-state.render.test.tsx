import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricState } from "./metric-state";

describe("MetricState render tests", () => {
  it("renders value and unit when MEASURED", () => {
    const html = renderToStaticMarkup(createElement(MetricState, {
      label: "건수",
      metric: { state: "MEASURED", value: 10, unit: "건", provenance: [] },
    }));
    expect(html).toContain("10 건");
  });

  it("renders Korean reason and state label when SOURCE_UNAVAILABLE", () => {
    const html = renderToStaticMarkup(createElement(MetricState, {
      label: "텔레메트리",
      metric: { state: "SOURCE_UNAVAILABLE", value: null, reason: "연동 준비 중", provenance: [] },
    }));
    expect(html).toContain("소스 연결 불가");
    expect(html).toContain("연동 준비 중");
  });
});
