/** Track M mail module contract — no OAuth/send/delete in portal body. */

export type MailMessageMeta = {
  id: string;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  groupKey?: string;
  preview?: string;
};

export type MailGroup = {
  key: string;
  label: string;
  messageCount: number;
};

export type TaskCandidate = {
  mailMessageId: string;
  title: string;
  summary: string;
  priority: "normal" | "high";
  entityType?: "customer" | "partner";
  entityId?: string;
};

export type EntityCandidate = {
  email: string;
  customerId?: string;
  partnerId?: string;
  confidence: number;
};

export type MailActorRole =
  | "customer"
  | "partner"
  | "vendor"
  | "internal"
  | "system_sender"
  | "unknown";

export type MailBusinessIntent =
  | "opportunity"
  | "renewal"
  | "poc"
  | "support"
  | "delivery"
  | "finance"
  | "legal"
  | "meeting"
  | "task"
  | "knowledge_only";

export type MailWorkflowStage =
  | "new_lead"
  | "discovery"
  | "proposal"
  | "approval"
  | "delivery"
  | "renewal"
  | "support";

export type MailActionability =
  | "ignore"
  | "reference"
  | "draft_task"
  | "review_candidate"
  | "auto_link_only";

export type MailRiskClass = "public" | "internal" | "confidential" | "credential_payment_regulated";

export type MailCandidateType = "customer" | "partner" | "task" | "opportunity" | "poc";

export type MailClassificationAxes = {
  actorRole: MailActorRole;
  businessIntent: MailBusinessIntent;
  workflowStage: MailWorkflowStage;
  actionability: MailActionability;
  riskClass: MailRiskClass;
};

export type MailClassificationScores = {
  modelConfidence: number;
  ruleConfidence: number;
  entityResolutionConfidence: number;
  duplicateProbability: number;
};

export type MailClassificationSignals = {
  ruleModelConflict: boolean;
  taxonomyDisagreement: boolean;
  newParticipantDomain: boolean;
  historicallyCorrectedSender: boolean;
};

export type MailEvidenceSpan = {
  messageId: string;
  kind: "subject" | "preview" | "body" | "attachment" | "metadata";
  text: string;
  hash: string;
};

export type MailClassificationDecision = {
  id: string;
  source: {
    provider: "outlook" | "gmail" | "upload" | "unknown";
    messageIds: string[];
    threadKey: string;
  };
  axes: MailClassificationAxes;
  scores: MailClassificationScores;
  signals: MailClassificationSignals;
  evidence: MailEvidenceSpan[];
  policyVersion: string;
  modelVersion?: string;
  promptVersion?: string;
};

export type MailUncertaintyReason =
  | "low_model_confidence"
  | "low_rule_confidence"
  | "low_entity_resolution"
  | "duplicate_probability"
  | "rule_model_conflict"
  | "taxonomy_disagreement"
  | "new_participant_domain"
  | "historically_corrected_sender"
  | "risk_class"
  | "unsafe_actionability";

export type MailUncertaintyResult = {
  score: number;
  requiresHumanReview: boolean;
  reasons: MailUncertaintyReason[];
};

export type MailSyncResult = {
  accounts: number;
  messages: number;
  groups: MailGroup[];
  taskCandidates: TaskCandidate[];
};

const HIGH_RISK_CLASSES = new Set<MailRiskClass>(["confidential", "credential_payment_regulated"]);
const UNSAFE_ACTIONABILITY = new Set<MailActionability>(["draft_task", "review_candidate"]);

function addReason(
  reasons: MailUncertaintyReason[],
  reason: MailUncertaintyReason,
  weight: number,
): number {
  reasons.push(reason);
  return weight;
}

function clampScore(score: number): number {
  return Math.min(1, Math.max(0, Number(score.toFixed(2))));
}

export function computeMailUncertainty(decision: MailClassificationDecision): MailUncertaintyResult {
  const reasons: MailUncertaintyReason[] = [];
  let score = 0;

  if (decision.scores.modelConfidence < 0.7) {
    score += addReason(reasons, "low_model_confidence", 0.25);
  }
  if (decision.scores.ruleConfidence < 0.6) {
    score += addReason(reasons, "low_rule_confidence", 0.15);
  }
  if (decision.scores.entityResolutionConfidence < 0.65) {
    score += addReason(reasons, "low_entity_resolution", 0.2);
  }
  if (decision.scores.duplicateProbability >= 0.45) {
    score += addReason(reasons, "duplicate_probability", 0.2);
  }
  if (decision.signals.ruleModelConflict) {
    score += addReason(reasons, "rule_model_conflict", 0.5);
  }
  if (decision.signals.taxonomyDisagreement) {
    score += addReason(reasons, "taxonomy_disagreement", 0.35);
  }
  if (decision.signals.newParticipantDomain) {
    score += addReason(reasons, "new_participant_domain", 0.15);
  }
  if (decision.signals.historicallyCorrectedSender) {
    score += addReason(reasons, "historically_corrected_sender", 0.3);
  }
  if (HIGH_RISK_CLASSES.has(decision.axes.riskClass)) {
    score += addReason(reasons, "risk_class", 0.55);
  }
  if (UNSAFE_ACTIONABILITY.has(decision.axes.actionability)) {
    score += addReason(reasons, "unsafe_actionability", 0.15);
  }

  const clamped = clampScore(score);
  return {
    score: clamped,
    requiresHumanReview:
      clamped >= 0.5 ||
      HIGH_RISK_CLASSES.has(decision.axes.riskClass) ||
      UNSAFE_ACTIONABILITY.has(decision.axes.actionability),
    reasons,
  };
}

export function projectMailCandidateType(
  decision: MailClassificationDecision,
): MailCandidateType | undefined {
  if (decision.axes.actorRole === "vendor" || decision.axes.actorRole === "internal") {
    return undefined;
  }
  if (decision.axes.actorRole === "system_sender" || decision.axes.actionability === "ignore") {
    return undefined;
  }
  if (decision.axes.actionability === "reference") {
    return undefined;
  }

  if (decision.axes.businessIntent === "opportunity" || decision.axes.businessIntent === "renewal") {
    return "opportunity";
  }
  if (decision.axes.businessIntent === "poc") {
    return "poc";
  }
  if (decision.axes.businessIntent === "task" || decision.axes.actionability === "draft_task") {
    return "task";
  }
  if (decision.axes.actorRole === "customer") {
    return "customer";
  }
  if (decision.axes.actorRole === "partner") {
    return "partner";
  }

  return undefined;
}
