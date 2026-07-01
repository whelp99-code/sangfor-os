import { describe, expect, it } from "vitest";

import {
  computeMailUncertainty,
  projectMailCandidateType,
  type MailClassificationDecision,
} from "./contract";

function decision(overrides: Partial<MailClassificationDecision> = {}): MailClassificationDecision {
  return {
    id: "decision-1",
    source: {
      provider: "outlook",
      messageIds: ["msg-1"],
      threadKey: "thread-1",
    },
    axes: {
      actorRole: "customer",
      businessIntent: "opportunity",
      workflowStage: "discovery",
      actionability: "review_candidate",
      riskClass: "internal",
    },
    scores: {
      modelConfidence: 0.82,
      ruleConfidence: 0.76,
      entityResolutionConfidence: 0.8,
      duplicateProbability: 0.1,
    },
    signals: {
      ruleModelConflict: false,
      taxonomyDisagreement: false,
      newParticipantDomain: false,
      historicallyCorrectedSender: false,
    },
    evidence: [
      {
        messageId: "msg-1",
        kind: "subject",
        text: "PoC opportunity discussion",
        hash: "hash-1",
      },
    ],
    policyVersion: "mail-learning-v1",
    modelVersion: "test-model",
    promptVersion: "test-prompt",
    ...overrides,
  };
}

describe("mail classification decision contract", () => {
  it("requires review for high-risk decisions even when model confidence is high", () => {
    const result = computeMailUncertainty(
      decision({
        axes: {
          actorRole: "customer",
          businessIntent: "opportunity",
          workflowStage: "approval",
          actionability: "review_candidate",
          riskClass: "credential_payment_regulated",
        },
        scores: {
          modelConfidence: 0.96,
          ruleConfidence: 0.91,
          entityResolutionConfidence: 0.93,
          duplicateProbability: 0.02,
        },
      }),
    );

    expect(result.requiresHumanReview).toBe(true);
    expect(result.reasons).toContain("risk_class");
  });

  it("requires review when rules and model disagree", () => {
    const result = computeMailUncertainty(
      decision({
        signals: {
          ruleModelConflict: true,
          taxonomyDisagreement: false,
          newParticipantDomain: false,
          historicallyCorrectedSender: false,
        },
      }),
    );

    expect(result.requiresHumanReview).toBe(true);
    expect(result.reasons).toContain("rule_model_conflict");
    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  it("projects clear opportunity decisions to the compatibility candidate type", () => {
    expect(projectMailCandidateType(decision())).toBe("opportunity");
  });

  it("does not project vendor reference mail to a CRM candidate type", () => {
    const projected = projectMailCandidateType(
      decision({
        axes: {
          actorRole: "vendor",
          businessIntent: "finance",
          workflowStage: "support",
          actionability: "reference",
          riskClass: "internal",
        },
      }),
    );

    expect(projected).toBeUndefined();
  });
});
