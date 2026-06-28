import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentStep } from "@sangfor/agent";

import { StepTimeline } from "./step-timeline";

const steps: AgentStep[] = [
  { index: 0, kind: "tool", tool: "sangfor.products", arguments: { a: 1 }, observation: { ok: true }, latencyMs: 12 },
  { index: 1, kind: "final", observation: "done" },
];

describe("StepTimeline render", () => {
  it("renders tool and final steps with labels and latency", () => {
    const html = renderToStaticMarkup(createElement(StepTimeline, { steps }));
    expect(html).toContain("sangfor.products");
    expect(html).toContain("12ms");
    expect(html).toContain("도구 호출");
    expect(html).toContain("완료");
  });

  it("renders nothing for an empty step list", () => {
    const html = renderToStaticMarkup(createElement(StepTimeline, { steps: [] }));
    expect(html).toBe("");
  });
});
