import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchiveCenter } from "./archive-center";

describe("ArchiveCenter render tests", () => {
  it("renders empty state notice when nodes array is empty", () => {
    const html = renderToStaticMarkup(createElement(ArchiveCenter, { initialNodes: [], totalCount: 0 }));
    expect(html).toContain("archive-center-empty");
    expect(html).toContain("보관된 항목이 없습니다");
  });

  it("renders table with items when nodes present", () => {
    const html = renderToStaticMarkup(createElement(ArchiveCenter, {
      initialNodes: [{ id: "c1", entityType: "customer", name: "Acme Corp", updatedAt: "2026-07-25T00:00:00Z" }],
      totalCount: 1,
    }));
    expect(html).toContain("archive-center");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("customer");
  });
});
