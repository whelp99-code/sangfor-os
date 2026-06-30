import { describe, expect, it } from "vitest";

import {
  canTransitionOpportunityStage,
  evaluateOpportunityQualification,
  validateOpportunityStageOrder,
} from "./opportunity-stage";

describe("opportunity qualification completion", () => {
  it("marks opportunity qualified when score and required discovery fields are present", () => {
    expect(
      evaluateOpportunityQualification({
        bantScore: 82,
        hasBudget: true,
        hasAuthority: true,
        hasNeed: true,
        hasTimeline: true,
        hasDiscoveryNote: true,
        hasSolutionFit: true,
      }),
    ).toEqual({
      status: "qualified",
      reasons: [],
      nextStage: "qualified",
    });
  });

  it("requires review when score is high but solution fit is missing", () => {
    expect(
      evaluateOpportunityQualification({
        bantScore: 82,
        hasBudget: true,
        hasAuthority: true,
        hasNeed: true,
        hasTimeline: true,
        hasDiscoveryNote: true,
        hasSolutionFit: false,
      }),
    ).toMatchObject({
      status: "requires_review",
      reasons: ["missing_solution_fit"],
    });
  });

  it("blocks quote stage transition before qualification", () => {
    expect(
      canTransitionOpportunityStage({
        from: "discovery",
        to: "quote",
        qualificationStatus: "needs_discovery",
      }),
    ).toEqual({ allowed: false, reason: "opportunity_must_be_qualified" });
  });

  it("blocks canonical proposal stage transition before qualification", () => {
    expect(
      canTransitionOpportunityStage({
        from: "QUALIFIED",
        to: "PROPOSAL",
        qualificationStatus: "needs_discovery",
      }),
    ).toEqual({ allowed: false, reason: "opportunity_must_be_qualified" });
  });
});

describe("validateOpportunityStageOrder", () => {
  it("allows adjacent forward advance (LEAD → QUALIFIED)", () => {
    expect(validateOpportunityStageOrder("LEAD", "QUALIFIED")).toEqual({
      allowed: true,
    });
  });

  it("allows adjacent forward advance through the pipeline", () => {
    expect(validateOpportunityStageOrder("PROPOSAL", "POC")).toEqual({ allowed: true });
    expect(validateOpportunityStageOrder("POC", "NEGOTIATION")).toEqual({ allowed: true });
    expect(validateOpportunityStageOrder("NEGOTIATION", "WON")).toEqual({ allowed: true });
  });

  it("allows backward revert/correction within the pipeline", () => {
    expect(validateOpportunityStageOrder("NEGOTIATION", "PROPOSAL")).toEqual({
      allowed: true,
    });
    expect(validateOpportunityStageOrder("QUALIFIED", "LEAD")).toEqual({ allowed: true });
  });

  it("allows marking a deal LOST from any active stage", () => {
    expect(validateOpportunityStageOrder("LEAD", "LOST")).toEqual({ allowed: true });
    expect(validateOpportunityStageOrder("NEGOTIATION", "LOST")).toEqual({ allowed: true });
  });

  it("treats same-stage as a no-op", () => {
    expect(validateOpportunityStageOrder("WON", "WON")).toEqual({ allowed: true });
  });

  it("allows correcting one terminal outcome into the other", () => {
    expect(validateOpportunityStageOrder("WON", "LOST")).toEqual({ allowed: true });
    expect(validateOpportunityStageOrder("LOST", "WON")).toEqual({ allowed: true });
  });

  it("rejects illegal regression out of a closed-won deal (WON → LEAD)", () => {
    expect(validateOpportunityStageOrder("WON", "LEAD")).toEqual({
      allowed: false,
      reason: "stage_is_terminal",
    });
  });

  it("rejects resurrecting a lost deal back into the pipeline (LOST → PROPOSAL)", () => {
    expect(validateOpportunityStageOrder("LOST", "PROPOSAL")).toEqual({
      allowed: false,
      reason: "stage_is_terminal",
    });
  });

  it("rejects forward skips of two or more stages (LEAD → PROPOSAL)", () => {
    expect(validateOpportunityStageOrder("LEAD", "PROPOSAL")).toEqual({
      allowed: false,
      reason: "stage_skip_forward",
    });
  });

  it("rejects jumping straight to WON without negotiation (LEAD → WON)", () => {
    expect(validateOpportunityStageOrder("LEAD", "WON")).toEqual({
      allowed: false,
      reason: "stage_skip_forward",
    });
  });

  it("normalizes legacy stage labels before ordering (discovery → qualified)", () => {
    expect(validateOpportunityStageOrder("discovery", "qualified")).toEqual({
      allowed: true,
    });
  });
});
