import { describe, it, expect } from "vitest";
import {
  ACTION_TIER_REGISTRY,
  FAIL_CLOSED_T2_ACTIONS,
  POLICY_VERSION,
  gateDecision,
} from "./ai-decision-policy";

describe("ACTION_TIER_REGISTRY", () => {
  it("registers stage_transition as T0", () => {
    expect(ACTION_TIER_REGISTRY.stage_transition).toBe("T0");
  });
  it("registers mail_revalidation as T1", () => {
    expect(ACTION_TIER_REGISTRY.mail_revalidation).toBe("T1");
  });
  it("exposes a POLICY_VERSION string", () => {
    expect(typeof POLICY_VERSION).toBe("string");
    expect(POLICY_VERSION.length).toBeGreaterThan(0);
  });

  it("does NOT register the S1-coverage contract/registration actions (fail-closed → T2)", () => {
    // 계약/재무/등록 관련 결정은 낮은 티어를 주지 않는다(스펙 §5).
    for (const action of FAIL_CLOSED_T2_ACTIONS) {
      expect(action in ACTION_TIER_REGISTRY).toBe(false);
    }
  });
});

describe("FAIL_CLOSED_T2_ACTIONS", () => {
  it("lists the newly instrumented coverage actions", () => {
    expect(FAIL_CLOSED_T2_ACTIONS).toContain("deal_registration");
    expect(FAIL_CLOSED_T2_ACTIONS).toContain("commercial_approval_resolution");
  });

  it("every listed action gates to T2 (requiresHuman, not auto)", () => {
    for (const action of FAIL_CLOSED_T2_ACTIONS) {
      const g = gateDecision("deal_registration", action);
      expect(g.tier).toBe("T2");
      expect(g.requiresHuman).toBe(true);
      expect(g.autoAllowed).toBe(false);
    }
  });
});

describe("gateDecision", () => {
  it("returns registered tier for a whitelisted T0 action", () => {
    const g = gateDecision("sales", "stage_transition");
    expect(g.tier).toBe("T0");
    expect(g.requiresHuman).toBe(false);
    expect(g.autoAllowed).toBe(true);
  });

  it("returns registered tier for a whitelisted T1 action (requires human, not auto)", () => {
    const g = gateDecision("sales", "mail_revalidation", 0.9);
    expect(g.tier).toBe("T1");
    // 1차: T1 = 승인후 발신 → 사람 필요, 자동 불가
    expect(g.requiresHuman).toBe(true);
    expect(g.autoAllowed).toBe(false);
  });

  it("fails closed for an UNREGISTERED action → T2, requiresHuman, not auto", () => {
    const g = gateDecision("cfo", "some_unregistered_action_xyz");
    expect(g.tier).toBe("T2");
    expect(g.requiresHuman).toBe(true);
    expect(g.autoAllowed).toBe(false);
  });

  it("fails closed for empty/undefined actionType → T2", () => {
    const g = gateDecision("sales", "");
    expect(g.tier).toBe("T2");
    expect(g.requiresHuman).toBe(true);
    expect(g.autoAllowed).toBe(false);
  });

  it("is a pure function (no confidence-based tier drift in 1차 labeling)", () => {
    const a = gateDecision("sales", "stage_transition", 0.1);
    const b = gateDecision("sales", "stage_transition", 0.99);
    expect(a.tier).toBe(b.tier);
    expect(a.requiresHuman).toBe(b.requiresHuman);
    expect(a.autoAllowed).toBe(b.autoAllowed);
  });
});
