import { describe, expect, it } from "vitest";

import {
  ACTIVE_OPPORTUNITY_STAGES,
  canTransitionOpportunityStage,
  evaluateOpportunityQualification,
  isActiveOpportunity,
  isRecognizedStage,
  normalizeOpportunityStage,
  validateOpportunityStageOrder,
  validateRegistrationGate,
} from "./opportunity-stage";

describe("opportunity qualification completion", () => {
  it("marks opportunity qualified when passing bant-tf-v1 qualification object is present", () => {
    expect(
      evaluateOpportunityQualification({
        qualification: {
          scoringVersion: "bant-tf-v1",
          passed: true,
          scoreTotal: 80,
        },
      }),
    ).toEqual({
      status: "qualified",
      reasons: [],
      nextStage: "qualified",
    });
  });

  it("returns needs_discovery when qualification is non-passing or stale", () => {
    expect(
      evaluateOpportunityQualification({
        qualification: {
          scoringVersion: "bant-v0",
          passed: true,
          scoreTotal: 80,
        },
      }),
    ).toMatchObject({
      status: "needs_discovery",
      reasons: ["stale_or_non_passing_qualification"],
    });
  });

  it("blocks stage transition past LEAD before passing qualification", () => {
    expect(
      canTransitionOpportunityStage({
        from: "LEAD",
        to: "QUALIFIED",
        qualificationStatus: "needs_discovery",
      }),
    ).toEqual({ allowed: false, reason: "opportunity_must_be_qualified" });
  });

  it("blocks canonical proposal stage transition before passing qualification", () => {
    expect(
      canTransitionOpportunityStage({
        from: "QUALIFIED",
        to: "PROPOSAL",
        qualification: { scoringVersion: "bant-v0", passed: true },
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

describe("validateRegistrationGate", () => {
  it("blocks WON advance when a registration-required deal is REJECTED", () => {
    expect(
      validateRegistrationGate({
        from: "NEGOTIATION",
        to: "WON",
        dealType: "NEW_BUILD",
        regStatus: "REJECTED",
      }),
    ).toEqual({ allowed: false, reason: "registration_rejected" });
  });

  it("blocks NEGOTIATION advance when registration is NOT_SUBMITTED", () => {
    expect(
      validateRegistrationGate({
        from: "POC",
        to: "NEGOTIATION",
        dealType: "SIMPLE_RESELL",
        regStatus: "NOT_SUBMITTED",
      }),
    ).toEqual({ allowed: false, reason: "registration_not_submitted" });
  });

  it("treats a missing registration row as NOT_SUBMITTED (blocks advance)", () => {
    expect(
      validateRegistrationGate({
        from: "POC",
        to: "NEGOTIATION",
        dealType: "NEW_BUILD",
        regStatus: null,
      }),
    ).toEqual({ allowed: false, reason: "registration_not_submitted" });
  });

  it("allows advance when registration is SUBMITTED or APPROVED", () => {
    expect(
      validateRegistrationGate({
        from: "NEGOTIATION",
        to: "WON",
        dealType: "NEW_BUILD",
        regStatus: "SUBMITTED",
      }),
    ).toEqual({ allowed: true });
    expect(
      validateRegistrationGate({
        from: "NEGOTIATION",
        to: "WON",
        dealType: "NEW_BUILD",
        regStatus: "APPROVED",
      }),
    ).toEqual({ allowed: true });
  });

  it("does not gate deal types that do not require registration (RENEWAL/UPSELL)", () => {
    expect(
      validateRegistrationGate({
        from: "NEGOTIATION",
        to: "WON",
        dealType: "RENEWAL",
        regStatus: "REJECTED",
      }),
    ).toEqual({ allowed: true });
    expect(
      validateRegistrationGate({
        from: "POC",
        to: "NEGOTIATION",
        dealType: "UPSELL",
        regStatus: null,
      }),
    ).toEqual({ allowed: true });
  });

  it("does not gate when dealType is null/undefined", () => {
    expect(
      validateRegistrationGate({
        from: "NEGOTIATION",
        to: "WON",
        dealType: null,
        regStatus: "REJECTED",
      }),
    ).toEqual({ allowed: true });
  });

  it("does not gate moves into non-gated stages (advance to POC)", () => {
    expect(
      validateRegistrationGate({
        from: "PROPOSAL",
        to: "POC",
        dealType: "NEW_BUILD",
        regStatus: "REJECTED",
      }),
    ).toEqual({ allowed: true });
  });

  it("does not gate backward moves or LOST out of a gated stage", () => {
    expect(
      validateRegistrationGate({
        from: "NEGOTIATION",
        to: "PROPOSAL",
        dealType: "NEW_BUILD",
        regStatus: "REJECTED",
      }),
    ).toEqual({ allowed: true });
    expect(
      validateRegistrationGate({
        from: "POC",
        to: "LOST",
        dealType: "NEW_BUILD",
        regStatus: "REJECTED",
      }),
    ).toEqual({ allowed: true });
  });
});

// ---------------------------------------------------------------------------
// Active-stage helpers (single source of truth for deal-metrics filters)
// ---------------------------------------------------------------------------
// The canonical set of "active / in-progress" stages is
// ["LEAD", "QUALIFIED", "PROPOSAL", "POC", "NEGOTIATION"].
// WON and LOST are the only two excluded (terminal outcomes).
//
// Rationale (recorded per audit 2026-07-03):
// 1. Real DB distribution — LEAD=27, PROPOSAL=16, WON=8, NEGOTIATION=6,
//    QUALIFIED=4, LOST=3, POC=0 — all 7 Prisma enum values appear.
// 2. Existing ad-hoc convention in
//    apps/web/src/components/deals/deals-board.tsx:
//    `const ACTIVE_STAGES = CANONICAL_STAGES.filter(s => s !== "WON" && s !== "LOST")`.
// 3. The home page "진행중 딜" (in-progress deals) metric independently
//    describes the same WON/LOST-excluded split.
//
// This test suite codifies that convention as the single source of truth.
describe("ACTIVE_OPPORTUNITY_STAGES and isActiveOpportunity", () => {
  it("contains LEAD through NEGOTIATION, excludes WON and LOST", () => {
    expect(ACTIVE_OPPORTUNITY_STAGES).toEqual([
      "LEAD",
      "QUALIFIED",
      "PROPOSAL",
      "POC",
      "NEGOTIATION",
    ]);
  });

  it("includes every active pipeline stage from ORDERED_PIPELINE", () => {
    expect(ACTIVE_OPPORTUNITY_STAGES).toContain("LEAD");
    expect(ACTIVE_OPPORTUNITY_STAGES).toContain("QUALIFIED");
    expect(ACTIVE_OPPORTUNITY_STAGES).toContain("PROPOSAL");
    expect(ACTIVE_OPPORTUNITY_STAGES).toContain("POC");
    expect(ACTIVE_OPPORTUNITY_STAGES).toContain("NEGOTIATION");
  });

  it("does not include terminal outcomes WON or LOST", () => {
    expect(ACTIVE_OPPORTUNITY_STAGES).not.toContain("WON");
    expect(ACTIVE_OPPORTUNITY_STAGES).not.toContain("LOST");
  });
});

describe("normalizeOpportunityStage (null-safe)", () => {
  it("returns LEAD for null input (safe fallback, never throws)", () => {
    expect(normalizeOpportunityStage(null)).toBe("LEAD");
  });

  it("returns LEAD for undefined input (safe fallback, never throws)", () => {
    expect(normalizeOpportunityStage(undefined)).toBe("LEAD");
  });

  it("still normalizes case-insensitively (string input preserved)", () => {
    expect(normalizeOpportunityStage("proposal")).toBe("PROPOSAL");
    expect(normalizeOpportunityStage("Proposal")).toBe("PROPOSAL");
    expect(normalizeOpportunityStage("PROPOSAL")).toBe("PROPOSAL");
  });

  it("trims whitespace before matching", () => {
    expect(normalizeOpportunityStage(" NEGOTIATION ")).toBe("NEGOTIATION");
    expect(normalizeOpportunityStage("\tPOC\n")).toBe("POC");
  });

  it("recognizes Korean display labels as legacy variants", () => {
    expect(normalizeOpportunityStage("리드")).toBe("LEAD");
    expect(normalizeOpportunityStage("검증")).toBe("QUALIFIED");
    expect(normalizeOpportunityStage("제안")).toBe("PROPOSAL");
    expect(normalizeOpportunityStage("협상")).toBe("NEGOTIATION");
    expect(normalizeOpportunityStage("수주")).toBe("WON");
    expect(normalizeOpportunityStage("실패")).toBe("LOST");
  });

  it("recognizes WON/LOST and Korean equivalents as valid stages", () => {
    expect(normalizeOpportunityStage("WON")).toBe("WON");
    expect(normalizeOpportunityStage("LOST")).toBe("LOST");
    expect(normalizeOpportunityStage("수주")).toBe("WON");
    expect(normalizeOpportunityStage("실패")).toBe("LOST");
  });

  // NOTE: "banana" falls back to "LEAD". This is intentional —
  // it matches the pre-existing behavior of the non-null overload
  // for unrecognised inputs, not a new design choice.
  it("falls back to LEAD for unrecognized garbage (preserves existing behavior)", () => {
    expect(normalizeOpportunityStage("banana")).toBe("LEAD");
  });
});

describe("isActiveOpportunity", () => {
  it("returns true for active stages", () => {
    expect(isActiveOpportunity("LEAD")).toBe(true);
    expect(isActiveOpportunity("QUALIFIED")).toBe(true);
    expect(isActiveOpportunity("PROPOSAL")).toBe(true);
    expect(isActiveOpportunity("POC")).toBe(true);
    expect(isActiveOpportunity("NEGOTIATION")).toBe(true);
  });

  it("returns false for terminal stages WON and LOST", () => {
    expect(isActiveOpportunity("WON")).toBe(false);
    expect(isActiveOpportunity("LOST")).toBe(false);
  });

  it("returns false for Korean labels of terminal stages", () => {
    expect(isActiveOpportunity("수주")).toBe(false);
    expect(isActiveOpportunity("실패")).toBe(false);
  });

  it("returns true for Korean labels of active stages", () => {
    expect(isActiveOpportunity("리드")).toBe(true);
    expect(isActiveOpportunity("검증")).toBe(true);
    expect(isActiveOpportunity("제안")).toBe(true);
    expect(isActiveOpportunity("협상")).toBe(true);
  });

  it("returns false for null input", () => {
    expect(isActiveOpportunity(null)).toBe(false);
  });

  it("returns false for undefined input", () => {
    expect(isActiveOpportunity(undefined)).toBe(false);
  });

  it("handles whitespace-padded input (trims first)", () => {
    expect(isActiveOpportunity(" WON ")).toBe(false);
    expect(isActiveOpportunity("  LEAD  ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isRecognizedStage — honest membership check (null-safe, no silent fallback)
// ---------------------------------------------------------------------------
describe("isRecognizedStage", () => {
  it("returns true for canonical uppercase stage values", () => {
    expect(isRecognizedStage("LEAD")).toBe(true);
    expect(isRecognizedStage("QUALIFIED")).toBe(true);
    expect(isRecognizedStage("PROPOSAL")).toBe(true);
    expect(isRecognizedStage("POC")).toBe(true);
    expect(isRecognizedStage("NEGOTIATION")).toBe(true);
    expect(isRecognizedStage("WON")).toBe(true);
    expect(isRecognizedStage("LOST")).toBe(true);
  });

  it("returns true for lowercase canonical values", () => {
    expect(isRecognizedStage("lead")).toBe(true);
    expect(isRecognizedStage("won")).toBe(true);
    expect(isRecognizedStage("lost")).toBe(true);
  });

  it("returns true for legacy/Korean display labels", () => {
    expect(isRecognizedStage("discovery")).toBe(true);
    expect(isRecognizedStage("qualification")).toBe(true);
    expect(isRecognizedStage("리드")).toBe(true);
    expect(isRecognizedStage("검증")).toBe(true);
    expect(isRecognizedStage("제안")).toBe(true);
    expect(isRecognizedStage("협상")).toBe(true);
    expect(isRecognizedStage("수주")).toBe(true);
    expect(isRecognizedStage("실패")).toBe(true);
  });

  it("returns true for whitespace-padded recognized input", () => {
    expect(isRecognizedStage("  LEAD  ")).toBe(true);
    expect(isRecognizedStage("\tPOC\n")).toBe(true);
  });

  it("returns false for unrecognized garbage strings", () => {
    expect(isRecognizedStage("banana")).toBe(false);
    expect(isRecognizedStage("foobar")).toBe(false);
    expect(isRecognizedStage("")).toBe(false);
    expect(isRecognizedStage(" ")).toBe(false);
  });

  it("returns false for null input", () => {
    expect(isRecognizedStage(null)).toBe(false);
  });

  it("returns false for undefined input", () => {
    expect(isRecognizedStage(undefined)).toBe(false);
  });
});
