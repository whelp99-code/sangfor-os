import { describe, expect, it } from "vitest";

import { UNSAFE_ACTIONS, requiresApprovalForAction } from "@sangfor/shared/modes";

import { evaluateProposalAction } from "./proposal-generator";
import { filterRevenueApprovalQueue } from "./revenue-core";

describe("revenue core approval queue", () => {
  const items = [
    { id: "quote-1", itemType: "quote", status: "ready_for_human_approval", ownerRole: "cfo", priority: "high" },
    { id: "proposal-1", itemType: "proposal", status: "draft", ownerRole: "sales", priority: "normal" },
    { id: "discount-1", itemType: "discount", status: "ready_for_human_approval", ownerRole: "cfo", priority: "normal" },
  ] as const;

  it("filters revenue approval queue by role and status", () => {
    expect(
      filterRevenueApprovalQueue(items, { ownerRole: "cfo", status: "ready_for_human_approval" }).map((item) => item.id),
    ).toEqual(["quote-1", "discount-1"]);
  });

  it("filters revenue approval queue by item type", () => {
    expect(filterRevenueApprovalQueue(items, { itemType: "proposal" }).map((item) => item.id)).toEqual([
      "proposal-1",
    ]);
  });
});

describe("proposal action guard", () => {
  it("blocks send/export/share for draft proposals", () => {
    expect(evaluateProposalAction({ status: "draft", action: "export" })).toEqual({
      allowed: false,
      reason: "proposal_action_requires_approval",
    });
    expect(evaluateProposalAction({ status: "draft", action: "send" }).allowed).toBe(false);
    expect(evaluateProposalAction({ status: "draft", action: "share" }).allowed).toBe(false);
  });

  it("allows unsafe proposal actions only for approved proposals", () => {
    expect(evaluateProposalAction({ status: "approved", action: "export" })).toEqual({ allowed: true });
  });

  it("allows review action for draft proposals", () => {
    expect(evaluateProposalAction({ status: "draft", action: "review" })).toEqual({ allowed: true });
  });
});

describe("unsafe action matrix", () => {
  it("keeps customer-facing proposal actions blocked until approval", () => {
    for (const action of ["send", "export", "share"] as const) {
      expect(evaluateProposalAction({ status: "draft", action })).toEqual({
        allowed: false,
        reason: "proposal_action_requires_approval",
      });
      expect(evaluateProposalAction({ status: "approved", action })).toEqual({ allowed: true });
    }
  });

  it("keeps shared unsafe actions approval-gated", () => {
    expect(UNSAFE_ACTIONS).toEqual(
      expect.arrayContaining([
        "send",
        "export",
        "share",
        "delete",
        "deploy",
        "real-upstream-write",
        "production-db-mutation",
        "release-tag",
      ]),
    );
    for (const action of UNSAFE_ACTIONS) {
      expect(requiresApprovalForAction(action)).toBe(true);
    }
  });
});
