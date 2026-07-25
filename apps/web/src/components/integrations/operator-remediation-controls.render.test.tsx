import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperatorRemediationControls } from "./operator-remediation-controls";

describe("OperatorRemediationControls render tests", () => {
  it("renders reprobe button", () => {
    const html = renderToStaticMarkup(createElement(OperatorRemediationControls, { targetId: "postgres-primary" }));
    expect(html).toContain("remediation-controls");
    expect(html).toContain("재측정");
  });
});
