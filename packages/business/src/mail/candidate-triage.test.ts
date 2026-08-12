import { describe, expect, it } from "vitest";

import {
  buildTriagePlan,
  learnDispositionRules,
  type DecidedCandidate,
  type PendingCandidate,
} from "./candidate-triage";

function decided(
  candidateType: DecidedCandidate["candidateType"],
  confidence: number,
  status: DecidedCandidate["status"],
  title = "t",
): DecidedCandidate {
  return { candidateType, confidence, status, title };
}

function pending(
  id: string,
  candidateType: PendingCandidate["candidateType"],
  confidence: number,
  title = "t",
): PendingCandidate {
  return { id, candidateType, confidence, title };
}

describe("learnDispositionRules", () => {
  it("learns a confidence floor from decisions that never converted below it", () => {
    const history: DecidedCandidate[] = [
      ...Array.from({ length: 40 }, () => decided("task", 65, "knowledge_only")),
      ...Array.from({ length: 40 }, () => decided("task", 75, "knowledge_only")),
      ...Array.from({ length: 40 }, () => decided("task", 85, "converted")),
    ];

    const rules = learnDispositionRules(history);

    expect(rules.confidenceFloor).toBe(80);
  });

  it("refuses to learn a floor when the sample below it is too small to trust", () => {
    const history: DecidedCandidate[] = [
      decided("task", 65, "knowledge_only"),
      decided("task", 85, "converted"),
    ];

    const rules = learnDispositionRules(history);

    expect(rules.confidenceFloor).toBeNull();
  });

  it("never learns a floor that would suppress a type that actually converted there", () => {
    const history: DecidedCandidate[] = [
      ...Array.from({ length: 40 }, () => decided("task", 75, "knowledge_only")),
      ...Array.from({ length: 30 }, () => decided("opportunity", 75, "converted")),
    ];

    const rules = learnDispositionRules(history);

    expect(rules.confidenceFloor).toBeNull();
  });

  it("learns which candidate types never convert", () => {
    const history: DecidedCandidate[] = [
      ...Array.from({ length: 25 }, () => decided("poc", 90, "rejected")),
      ...Array.from({ length: 25 }, () => decided("task", 90, "converted")),
    ];

    const rules = learnDispositionRules(history);

    expect(rules.neverConvertingTypes).toContain("poc");
    expect(rules.neverConvertingTypes).not.toContain("task");
  });

  it("does not call a type never-converting on a thin sample", () => {
    const history: DecidedCandidate[] = [decided("poc", 90, "rejected")];

    const rules = learnDispositionRules(history);

    expect(rules.neverConvertingTypes).toEqual([]);
  });
});

describe("buildTriagePlan", () => {
  const rules = { confidenceFloor: 80, neverConvertingTypes: ["poc"] as const };

  it("auto-files candidates below the learned confidence floor as knowledge_only", () => {
    const plan = buildTriagePlan({
      pending: [pending("a", "task", 70)],
      rules: { confidenceFloor: 80, neverConvertingTypes: [] },
      convertedTitles: new Set(),
      knownPolicyKeys: [],
    });

    expect(plan.decisions).toEqual([
      expect.objectContaining({ id: "a", nextStatus: "knowledge_only", rule: "low_confidence" }),
    ]);
  });

  it("auto-files a type that never converts", () => {
    const plan = buildTriagePlan({
      pending: [pending("a", "poc", 95)],
      rules: { confidenceFloor: null, neverConvertingTypes: ["poc"] },
      convertedTitles: new Set(),
      knownPolicyKeys: [],
    });

    expect(plan.decisions[0]).toMatchObject({ nextStatus: "knowledge_only", rule: "never_converts" });
  });

  it("auto-files a duplicate of an already converted entity", () => {
    const plan = buildTriagePlan({
      pending: [pending("a", "partner", 95, "Partner: Nexias")],
      rules: { confidenceFloor: null, neverConvertingTypes: [] },
      convertedTitles: new Set(["partner\u0000partner: nexias"]),
      knownPolicyKeys: [],
    });

    expect(plan.decisions[0]).toMatchObject({ nextStatus: "knowledge_only", rule: "already_converted" });
  });

  it("keeps a genuinely new high-confidence candidate for a human", () => {
    const plan = buildTriagePlan({
      pending: [pending("a", "opportunity", 92, "Opportunity: 새 고객")],
      rules,
      convertedTitles: new Set(),
      knownPolicyKeys: [],
    });

    expect(plan.decisions).toHaveLength(0);
    expect(plan.humanReview.map((c) => c.id)).toEqual(["a"]);
  });

  it("collapses duplicate human-review candidates to one representative, keeping the highest confidence", () => {
    const plan = buildTriagePlan({
      pending: [
        pending("low", "partner", 84, "Partner: 동일"),
        pending("high", "partner", 93, "Partner: 동일"),
      ],
      rules,
      convertedTitles: new Set(),
      knownPolicyKeys: [],
    });

    expect(plan.humanReview.map((c) => c.id)).toEqual(["high"]);
    expect(plan.decisions).toEqual([
      expect.objectContaining({ id: "low", nextStatus: "knowledge_only", rule: "duplicate_of_pending" }),
    ]);
  });

  it("never auto-converts: every automated decision only files to knowledge_only", () => {
    const plan = buildTriagePlan({
      pending: [
        pending("a", "task", 10),
        pending("b", "poc", 99),
        pending("c", "partner", 95, "Partner: Nexias"),
      ],
      rules: { confidenceFloor: 80, neverConvertingTypes: ["poc"] },
      convertedTitles: new Set(["partner\u0000partner: nexias"]),
      knownPolicyKeys: [],
    });

    expect(plan.decisions).toHaveLength(3);
    for (const decision of plan.decisions) {
      expect(decision.nextStatus).toBe("knowledge_only");
    }
  });

  it("records the evidence that justifies each automated decision", () => {
    const plan = buildTriagePlan({
      pending: [pending("a", "task", 70)],
      rules: { confidenceFloor: 80, neverConvertingTypes: [] },
      convertedTitles: new Set(),
      knownPolicyKeys: [],
    });

    expect(plan.decisions[0].evidence).toContain("80");
  });
});
