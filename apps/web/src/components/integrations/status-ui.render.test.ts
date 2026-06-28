import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StatusPill } from "./status-ui";

// Static-render component tests (no jsdom dependency required).
describe("StatusPill render", () => {
  it("renders label, status role and aria-label for healthy", () => {
    const html = renderToStaticMarkup(createElement(StatusPill, { status: "healthy" }));
    expect(html).toContain("정상");
    expect(html).toContain('role="status"');
    expect(html).toContain("상태: 정상");
  });

  it("renders the unreachable label", () => {
    const html = renderToStaticMarkup(createElement(StatusPill, { status: "unreachable" }));
    expect(html).toContain("연결불가");
  });
});
