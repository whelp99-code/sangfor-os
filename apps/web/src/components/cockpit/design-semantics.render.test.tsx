import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VerificationConsole } from "./verification-console";
import { DispatchSlip } from "./dispatch-slip";
import { RoleAIBadge } from "./role-ai-badge";
import { CommanderButton } from "./commander-button";

describe("Cockpit design semantics render tests", () => {
  it("renders VerificationConsole with ai-validation semantic attribute", () => {
    const html = renderToStaticMarkup(createElement(VerificationConsole, { gate: "B" }));
    expect(html).toContain('data-design-semantic="ai-validation"');
    expect(html).toContain("[B]");
  });

  it("renders DispatchSlip container with correct data attribute", () => {
    const html = renderToStaticMarkup(createElement(DispatchSlip, { header: "안건", draft: "초안" }));
    expect(html).toContain('data-design-component="DispatchSlip"');
  });

  it("renders RoleAIBadge with code and label", () => {
    const html = renderToStaticMarkup(createElement(RoleAIBadge, { code: "MK", label: "마케팅 에이전트" }));
    expect(html).toContain("MK");
    expect(html).toContain("마케팅 에이전트");
  });

  it("renders CommanderButton with human-decision semantic attribute", () => {
    const html = renderToStaticMarkup(createElement(CommanderButton, {}, "승인"));
    expect(html).toContain('data-design-semantic="human-decision"');
    expect(html).toContain("승인");
  });
});
