import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteState } from "./route-state";

describe("RouteState render tests", () => {
  it("renders Korean loading copy", () => {
    const html = renderToStaticMarkup(createElement(RouteState, { kind: "loading" }));
    expect(html).toContain("불러오는 중…");
  });

  it("renders Korean error copy and retry button when onRetry provided", () => {
    const html = renderToStaticMarkup(createElement(RouteState, { kind: "error", code: "ERR_500", onRetry: () => {} }));
    expect(html).toContain("오류가 발생했습니다");
    expect(html).toContain("ERR_500");
    expect(html).toContain("다시 시도");
  });
});
