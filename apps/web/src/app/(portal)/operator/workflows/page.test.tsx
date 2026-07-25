import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OperatorWorkflowsPage from "./page";

describe("OperatorWorkflowsPage", () => {
  it("renders canonical operator workflows page", () => {
    const html = renderToStaticMarkup(createElement(OperatorWorkflowsPage));
    expect(html).toContain("Operator Workflows Workspace");
    expect(html).toContain("system_admin");
  });
});
