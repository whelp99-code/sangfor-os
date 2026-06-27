import { describe, expect, it } from "vitest";

import { buildProposalActionGuards } from "./proposal-action-guards";

describe("buildProposalActionGuards", () => {
  it("requires approval before customer-facing proposal actions are allowed", () => {
    expect(buildProposalActionGuards("draft")).toEqual({
      send: { allowed: false, reason: "proposal_action_requires_approval" },
      export: { allowed: false, reason: "proposal_action_requires_approval" },
      share: { allowed: false, reason: "proposal_action_requires_approval" },
    });
  });

  it("allows customer-facing proposal actions for approved proposals", () => {
    expect(buildProposalActionGuards("approved")).toEqual({
      send: { allowed: true },
      export: { allowed: true },
      share: { allowed: true },
    });
  });
});
