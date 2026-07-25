import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SchedulerHistory } from "./scheduler-history";

describe("SchedulerHistory render tests", () => {
  it("renders empty state", () => {
    const html = renderToStaticMarkup(createElement(SchedulerHistory, { runs: [] }));
    expect(html).toContain("scheduler-history");
    expect(html).toContain("실행 내역이 없습니다.");
  });
});
