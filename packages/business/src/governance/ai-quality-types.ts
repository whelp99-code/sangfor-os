export type AiQualityEnvelopeV1 = {
  artifactVersionId: string;
  artifactContentHash: string;
  evidence: AiQualityEvidenceInput[];
  citations: AiQualityCitation[];
  sourceCoverage: number;
  knownGaps: string[];
  missingInfo: string[];
  confidenceBasis: Record<string, unknown>;
  injectionDetected: boolean;
  injectionBlockRate: number;
  leakageDetected: boolean;
  leakageCount: number;
  promptProvenance: AiPromptProvenance[];
  modelProvenance: AiModelProvenance[];
  toolProvenance: AiToolProvenance[];
  evaluatorKey: string;
  evaluatorVersion: string;
  requiredHumanReviews: AiPolicySlot[];
  blockers: string[];
  qualityPassed: boolean;
  customerSendAllowed: boolean;
  evaluatedAt: string;
  policyKey: string;
  policyVersion: string;
  score: number;
};

export type AiQualityEvidenceInput = {
  sourceKind: string;
  sourceReference: string;
  sourceHash: string;
  sourceArtifactVersionId?: string | null;
  citation: Record<string, unknown>;
  coverage: Record<string, unknown>;
};

export type AiQualityCitation = {
  sourceKind: string;
  sourceReference: string;
  cited: boolean;
};

export type AiPromptProvenance = {
  promptKey: string;
  promptVersion: string;
  promptHash: string;
  toolKey: string;
  toolVersion: string;
  toolHash: string;
  classification: string;
  approved: boolean;
  approvalReference?: string | null;
  releaseReference?: string | null;
};

export type AiModelProvenance = {
  modelKey: string;
  modelVersion: string;
  modelHash: string;
  toolKey: string;
  toolVersion: string;
  toolHash: string;
  classification: string;
  approved: boolean;
  approvalReference?: string | null;
  releaseReference?: string | null;
};

export type AiToolProvenance = {
  toolKey: string;
  toolVersion: string;
  toolHash: string;
  approved: boolean;
};

export type AiPolicySlot = {
  slotKey: string;
  businessRole: string;
  capability: string;
  order: number;
};

export type AiQualityPolicy = {
  policyKey: string;
  policyVersion: string;
  slots: AiPolicySlot[];
  quorum: number;
};

export const AI_QUALITY_THRESHOLDS = {
  MIN_SCORE: 85,
  MIN_INJECTION_BLOCK: 95,
  MAX_LEAKAGE: 0,
  MIN_SOURCE_COVERAGE: 80,
} as const;

export const AI_QUALITY_POLICIES: Record<string, AiQualityPolicy> = {
  "proposal.human_review.v1": {
    policyKey: "proposal.human_review.v1",
    policyVersion: "1",
    quorum: 2,
    slots: [
      { slotKey: "proposal.presales", businessRole: "presales_engineer", capability: "ai_quality.review", order: 1 },
      { slotKey: "proposal.account", businessRole: "account_manager", capability: "ai_quality.review", order: 2 },
    ],
  },
  "domain_proposal.human_review.v1": {
    policyKey: "domain_proposal.human_review.v1",
    policyVersion: "1",
    quorum: 2,
    slots: [
      { slotKey: "domain_proposal.architect", businessRole: "solution_architect", capability: "ai_quality.review", order: 1 },
      { slotKey: "domain_proposal.account", businessRole: "account_manager", capability: "ai_quality.review", order: 2 },
    ],
  },
  "quote.internal_release.human_review.v1": {
    policyKey: "quote.internal_release.human_review.v1",
    policyVersion: "1",
    quorum: 2,
    slots: [
      { slotKey: "quote.internal_release.sales", businessRole: "sales_manager", capability: "ai_quality.review", order: 1 },
      { slotKey: "quote.internal_release.finance", businessRole: "finance_manager", capability: "ai_quality.review", order: 2 },
    ],
  },
  "support.rca.human_review.v1": {
    policyKey: "support.rca.human_review.v1",
    policyVersion: "1",
    quorum: 2,
    slots: [
      { slotKey: "support.rca.support_lead", businessRole: "support_engineer", capability: "support.rca.review.lead", order: 1 },
      { slotKey: "support.rca.solution_architect", businessRole: "solution_architect", capability: "support.rca.review.architect", order: 2 },
    ],
  },
};

export const WRAPPER_POLICY_SELECTOR: Record<string, Record<string, string>> = {
  proposal: {
    "ai.internal_release": "proposal.human_review.v1",
    "ai.customer_send": "proposal.human_review.v1",
  },
  domain_proposal: {
    "ai.internal_release": "domain_proposal.human_review.v1",
    "ai.customer_send": "domain_proposal.human_review.v1",
  },
  quote: {
    "quote.internal_release": "quote.internal_release.human_review.v1",
  },
  support_rca: {
    "support.rca.internal_approval": "support.rca.human_review.v1",
  },
};

export const RELEASE_SELECTOR: Record<string, Record<string, string>> = {
  proposal: {
    "ai.internal_release": "proposal.human_review.v1",
    "ai.customer_send": "proposal.human_review.v1",
  },
  domain_proposal: {
    "ai.internal_release": "domain_proposal.human_review.v1",
    "ai.customer_send": "domain_proposal.human_review.v1",
  },
  quote: {
    "quote.internal_release": "quote.internal_release.human_review.v1",
  },
};
