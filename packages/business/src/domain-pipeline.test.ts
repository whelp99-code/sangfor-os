import { describe, it, expect } from "vitest";
import { GTM_PIPELINE, nextGtmDomain } from "@sangfor/shared/modes";
import {
  DOMAIN_DEFINITIONS,
  lensesForDomain,
  buildDomainHandoff,
  pipelineOverview,
} from "./domain-pipeline";

describe("GTM pipeline (종축)", () => {
  it("orders domains marketing → sales → presales → engineer → cfo", () => {
    expect([...GTM_PIPELINE]).toEqual(["marketing", "sales", "presales", "engineer", "cfo"]);
  });

  it("chains each domain to the next, cfo terminates", () => {
    expect(nextGtmDomain("marketing")).toBe("sales");
    expect(nextGtmDomain("presales")).toBe("engineer");
    expect(nextGtmDomain("cfo")).toBeNull();
  });

  it("DOMAIN_DEFINITIONS.next agrees with nextGtmDomain", () => {
    for (const domain of GTM_PIPELINE) {
      expect(DOMAIN_DEFINITIONS[domain].next).toBe(nextGtmDomain(domain));
    }
  });
});

describe("color lenses per domain (종축 × 횡축)", () => {
  it("marketing → orange + teal", () => {
    expect(lensesForDomain("marketing").required.sort()).toEqual(["orange", "teal"]);
  });

  it("sales → orange + red + gray", () => {
    expect(lensesForDomain("sales").required.sort()).toEqual(["gray", "orange", "red"]);
  });

  it("presales → blue + gray", () => {
    expect(lensesForDomain("presales").required.sort()).toEqual(["blue", "gray"]);
  });

  it("engineer → blue + red + purple (purple from domain lens)", () => {
    expect(lensesForDomain("engineer").required.sort()).toEqual(["blue", "purple", "red"]);
  });

  it("cfo → orange + red", () => {
    expect(lensesForDomain("cfo").required.sort()).toEqual(["orange", "red"]);
  });

  it("overrides escalate lenses (critical risk pulls in more colors)", () => {
    const base = lensesForDomain("marketing").required;
    const escalated = lensesForDomain("marketing", { riskLevel: "critical" }).required;
    expect(escalated.length).toBeGreaterThan(base.length);
  });
});

describe("handoff descriptors", () => {
  it("builds from → to with required lenses", () => {
    const h = buildDomainHandoff("sales");
    expect(h.from).toBe("sales");
    expect(h.to).toBe("presales");
    expect(h.artifact).toBe("opportunity-with-quote");
    expect(h.requiredLenses).toContain("orange");
  });

  it("pipelineOverview covers every GTM domain", () => {
    const overview = pipelineOverview();
    expect(overview.map((o) => o.from)).toEqual([...GTM_PIPELINE]);
    expect(overview[overview.length - 1].to).toBeNull();
  });
});
