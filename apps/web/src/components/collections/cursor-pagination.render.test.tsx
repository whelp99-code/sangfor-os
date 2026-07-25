import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CursorPagination } from "./cursor-pagination";

describe("CursorPagination render tests", () => {
  it("renders null when both hasNextPage and hasPreviousPage are false", () => {
    const html = renderToStaticMarkup(createElement(CursorPagination, {
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
    }));
    expect(html).toBe("");
  });

  it("renders pagination controls with Korean aria-labels when hasNextPage is true", () => {
    const html = renderToStaticMarkup(createElement(CursorPagination, {
      pageInfo: { hasNextPage: true, hasPreviousPage: false, startCursor: "c1", endCursor: "c50" },
    }));
    expect(html).toContain("cursor-pagination");
    expect(html).toContain("다음 페이지");
    expect(html).toContain("이전 페이지");
  });
});
