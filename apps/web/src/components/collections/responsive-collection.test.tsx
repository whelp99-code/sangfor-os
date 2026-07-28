import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResponsiveCollection } from "./responsive-collection";

describe("ResponsiveCollection single-DOM tests", () => {
  it("renders every record exactly once in one responsive collection tree", () => {
    const items = Array.from({ length: 50 }, (_, index) => ({ id: `record-${index + 1}` }));
    const html = renderToStaticMarkup(
      <ResponsiveCollection
        items={items}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.id}</span>}
      />,
    );

    expect(html.match(/data-responsive-collection=/g)).toHaveLength(1);
    expect(html.match(/data-record-id=/g)).toHaveLength(50);
    for (const item of items) {
      expect(html.match(new RegExp(`data-record-id="${item.id}"`, "g"))).toHaveLength(1);
    }
    expect(html).not.toMatch(/(?:md:hidden|hidden md:block)/);
  });
});
