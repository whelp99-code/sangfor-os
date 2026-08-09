import { describe, expect, it } from "vitest";
import {
  evaluateMailAiRejectGate,
  exitCodeForMailAiRejectGate,
  MAIL_AI_REJECT_GATE_SCHEMA,
  selectSecondaryNotOpportunitySample,
  type FrozenRejectPopulation,
  type RejectReview,
} from "./mail-ai-reject-gate";

function population(ids: string[]): FrozenRejectPopulation {
  return {
    schemaVersion: MAIL_AI_REJECT_GATE_SCHEMA,
    scope: "all_ai_rejects",
    frozen: true,
    cycle: {
      cycleId: "cycle-1",
      model: "test-model",
      promptConfigId: "prompt-2026-08-09",
      startedAt: "2026-08-09T00:00:00Z",
      endedAt: "2026-08-09T01:00:00Z",
    },
    candidates: ids.map((candidateId, index) => ({
      candidateId,
      candidateType: (["task", "opportunity", "poc"] as const)[index % 3],
      aiDecision: "reject",
      evidenceRef: `candidate:${candidateId}`,
    })),
  };
}

function review(candidateId: string, reviewerRole: "primary" | "secondary", label: RejectReview["label"]): RejectReview {
  return {
    candidateId,
    reviewerRole,
    reviewerId: `${reviewerRole}-reviewer`,
    label,
    evidenceRef: `review:${candidateId}:${reviewerRole}`,
  };
}

function reviews(rows: RejectReview[]) {
  return { schemaVersion: MAIL_AI_REJECT_GATE_SCHEMA, cycleId: "cycle-1", reviews: rows };
}

describe("mail AI reject gate", () => {
  it("PASSes an exact full census with its deterministic 10% secondary sample", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const selected = selectSecondaryNotOpportunitySample("cycle-1", ids);
    const result = evaluateMailAiRejectGate(
      population(ids),
      reviews([...ids.map((id) => review(id, "primary", "not_opportunity")), ...selected.map((id) => review(id, "secondary", "not_opportunity"))]),
    );

    expect(selected).toEqual(["a"]);
    expect(result).toMatchObject({ status: "PASS", exitCode: 0, populationCount: 10, primaryReviewCount: 10, secondaryReviewCount: 1 });
  });

  it("accepts additional secondary reviews beyond the required minimum", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const result = evaluateMailAiRejectGate(
      population(ids),
      reviews([...ids.map((id) => review(id, "primary", "not_opportunity")), ...ids.map((id) => review(id, "secondary", "not_opportunity"))]),
    );

    expect(result).toMatchObject({ status: "PASS", primaryReviewCount: 10, secondaryReviewCount: 10 });
  });

  it("FAILs when either reviewer identifies an actual opportunity", () => {
    const result = evaluateMailAiRejectGate(
      population(["a"]),
      reviews([review("a", "primary", "actual_opportunity"), review("a", "secondary", "actual_opportunity")]),
    );

    expect(result).toMatchObject({ status: "FAIL", exitCode: 1 });
  });

  it("BLOCKs valid input with missing required review coverage", () => {
    const result = evaluateMailAiRejectGate(
      population(["a"]),
      reviews([review("a", "primary", "not_opportunity")]),
    );

    expect(result).toMatchObject({ status: "BLOCKED", exitCode: 2 });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "MISSING_SECONDARY_REVIEW", candidateId: "a" }));
  });

  it("enforces a full census above 200 candidates instead of a random-30 shortcut", () => {
    const ids = Array.from({ length: 201 }, (_, index) => `candidate-${index + 1}`);
    const selected = selectSecondaryNotOpportunitySample("cycle-1", ids);
    const result = evaluateMailAiRejectGate(
      population(ids),
      reviews([...ids.map((id) => review(id, "primary", "not_opportunity")), ...selected.map((id) => review(id, "secondary", "not_opportunity"))]),
    );

    expect(selected).toHaveLength(21);
    expect(result).toMatchObject({ status: "PASS", populationCount: 201, primaryReviewCount: 201, secondaryReviewCount: 21 });
  });

  it("uses a stable SHA-256 rank for the secondary sample", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "a"];

    expect(selectSecondaryNotOpportunitySample("cycle-1", ids)).toEqual(["a"]);
    expect(selectSecondaryNotOpportunitySample("cycle-2", ids)).toEqual(selectSecondaryNotOpportunitySample("cycle-2", [...ids].reverse()));
  });

  it("BLOCKs insufficient evidence and a mismatched additional secondary review", () => {
    const insufficient = evaluateMailAiRejectGate(
      population(["a"]),
      reviews([review("a", "primary", "insufficient_evidence"), review("a", "secondary", "insufficient_evidence")]),
    );
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const mismatch = evaluateMailAiRejectGate(
      population(ids),
      reviews([
        ...ids.map((id) => review(id, "primary", "not_opportunity")),
        review("a", "secondary", "not_opportunity"),
        review("b", "secondary", "insufficient_evidence"),
      ]),
    );

    expect(insufficient).toMatchObject({ status: "BLOCKED", exitCode: 2 });
    expect(mismatch).toMatchObject({ status: "BLOCKED", exitCode: 2 });
    expect(mismatch.issues).toContainEqual(expect.objectContaining({ code: "LABEL_MISMATCH", candidateId: "b" }));
  });

  it("rejects duplicate and extra review rows as invalid input", () => {
    const duplicate = evaluateMailAiRejectGate(
      population(["a"]),
      reviews([review("a", "primary", "not_opportunity"), review("a", "primary", "not_opportunity")]),
    );
    const extra = evaluateMailAiRejectGate(
      population(["a"]),
      reviews([review("a", "primary", "not_opportunity"), review("other", "secondary", "not_opportunity")]),
    );

    expect(duplicate).toMatchObject({ status: "INVALID", exitCode: 64 });
    expect(extra).toMatchObject({ status: "INVALID", exitCode: 64 });
  });

  it("maps outcomes to the documented process exit codes", () => {
    expect(exitCodeForMailAiRejectGate("PASS")).toBe(0);
    expect(exitCodeForMailAiRejectGate("FAIL")).toBe(1);
    expect(exitCodeForMailAiRejectGate("BLOCKED")).toBe(2);
    expect(exitCodeForMailAiRejectGate("INVALID")).toBe(64);
  });
});
