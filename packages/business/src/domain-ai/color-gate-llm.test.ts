import { describe, it, expect } from "vitest";
import { parseColorGateVerdict, verifyProposalColorGate } from "./color-gate-llm";

describe("parseColorGateVerdict", () => {
  it("parses a well-formed 5-lens verdict", () => {
    const raw = JSON.stringify({
      blue: { pass: true, note: "기술 타당" },
      red: { pass: false, note: "리스크 대응 누락" },
      orange: { pass: true, note: "가치 명확" },
      gray: { pass: true, note: "근거 충분" },
      teal: { pass: true, note: "명료" },
      pass: false,
      summary: "리스크 렌즈 보완 필요",
    });
    const v = parseColorGateVerdict(raw, "cx/gpt-5.4-mini-review");
    expect(v.mode).toBe("llm");
    expect(v.model).toBe("cx/gpt-5.4-mini-review");
    expect(v.lenses.red.pass).toBe(false);
    expect(v.lenses.red.note).toContain("누락");
    expect(v.pass).toBe(false);
    expect(v.summary).toContain("리스크");
  });

  it("strips ```json code fences", () => {
    const raw = '```json\n{"blue":{"pass":true,"note":"a"},"red":{"pass":true,"note":"b"},"orange":{"pass":true,"note":"c"},"gray":{"pass":true,"note":"d"},"teal":{"pass":true,"note":"e"},"pass":true,"summary":"ok"}\n```';
    const v = parseColorGateVerdict(raw, "m");
    expect(v.pass).toBe(true);
    expect(v.lenses.blue.note).toBe("a");
  });

  it("derives overall pass from lenses when top-level pass is missing", () => {
    const raw = JSON.stringify({
      blue: { pass: true, note: "" },
      red: { pass: true, note: "" },
      orange: { pass: false, note: "" },
      gray: { pass: true, note: "" },
      teal: { pass: true, note: "" },
      summary: "s",
    });
    const v = parseColorGateVerdict(raw, "m");
    expect(v.pass).toBe(false); // orange fails → overall false
  });
});

describe("verifyProposalColorGate (injected LLM)", () => {
  it("routes through deps.callLLM and returns a parsed verdict", async () => {
    let seenUser = "";
    const v = await verifyProposalColorGate(
      { domain: "presales", title: "T", bodyMarkdown: "B", customerName: "고객사" },
      {
        callLLM: async (_system, user) => {
          seenUser = user;
          return JSON.stringify({
            blue: { pass: true, note: "" },
            red: { pass: true, note: "" },
            orange: { pass: true, note: "" },
            gray: { pass: true, note: "" },
            teal: { pass: true, note: "" },
            pass: true,
            summary: "good",
          });
        },
      },
    );
    expect(v.pass).toBe(true);
    expect(v.summary).toBe("good");
    expect(seenUser).toContain("고객사");
    expect(seenUser).toContain("presales");
  });
});
