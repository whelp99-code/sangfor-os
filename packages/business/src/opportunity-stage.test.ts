import { describe, expect, it } from "vitest";

import {
  canTransitionOpportunityStage,
  evaluateOpportunityQualification,
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
