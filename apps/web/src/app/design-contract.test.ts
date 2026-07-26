import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type ViolationCode = "AI_VALIDATION_COLOR_MISUSE" | "BRASS_HUMAN_ACTION_MISUSE" | "COLOR_ONLY_SEMANTIC";

const AI_TOKEN = /var\(--ck-(?:blue|blue-deep|red|red-deep|orange|orange-deep|gray|gray-deep|teal|teal-deep)\)/;
const BRASS_TOKEN = /var\(--ck-(?:brass|brass-ink|brass-bg|brass-line)\)/;

function analyze(source: string, owner: "verification" | "commander" | "other"): ViolationCode[] {
  const violations: ViolationCode[] = [];
  if (AI_TOKEN.test(source) && owner !== "verification") violations.push("AI_VALIDATION_COLOR_MISUSE");
  if (BRASS_TOKEN.test(source) && owner !== "commander") violations.push("BRASS_HUMAN_ACTION_MISUSE");
  if (owner === "verification" && AI_TOKEN.test(source)
    && (!source.includes("aria-label") || !source.includes("sentence") || !source.includes("level"))) {
    violations.push("COLOR_ONLY_SEMANTIC");
  }
  return violations;
}

function componentSource(file: string): string {
  return readFileSync(resolve(import.meta.dirname, `../components/cockpit/${file}`), "utf8");
}

describe("Design Contract static source tests", () => {
  it("keeps AI and human-decision palette usage inside semantic owners", () => {
    expect(analyze(componentSource("verification-console.tsx"), "verification")).toEqual([]);
    expect(analyze(componentSource("commander-button.tsx"), "commander")).toEqual([]);
    expect(analyze(componentSource("role-ai-badge.tsx"), "other")).toEqual([]);
    expect(componentSource("verification-console.tsx")).toContain('data-design-semantic="ai-validation"');
    expect(componentSource("commander-button.tsx")).toContain('data-design-semantic="human-decision"');
  });

  it.each([
    ["AI_VALIDATION_COLOR_MISUSE", '<div style={{ color: "var(--ck-red-deep)" }} />', "other"],
    ["BRASS_HUMAN_ACTION_MISUSE", '<span style={{ color: "var(--ck-brass)" }}>AI</span>', "other"],
    ["COLOR_ONLY_SEMANTIC", '<i style={{ color: "var(--ck-blue)" }} />', "verification"],
  ] as const)("rejects the %s mutation", (code, source, owner) => {
    expect(analyze(source, owner)).toContain(code);
  });
});
