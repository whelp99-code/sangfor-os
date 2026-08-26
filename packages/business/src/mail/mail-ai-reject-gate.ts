import { createHash } from "node:crypto";

export const MAIL_AI_REJECT_GATE_SCHEMA = "mail-ai-reject-gate/v1";

type CandidateType = "task" | "opportunity" | "poc";
export type ReviewLabel = "actual_opportunity" | "not_opportunity" | "insufficient_evidence";
type GateStatus = "PASS" | "FAIL" | "BLOCKED" | "INVALID";

export interface RejectCandidate {
  candidateId: string;
  candidateType: CandidateType;
  aiDecision: "reject";
  evidenceRef?: string;
}

export interface FrozenRejectPopulation {
  schemaVersion: typeof MAIL_AI_REJECT_GATE_SCHEMA;
  scope: "all_ai_rejects";
  frozen: true;
  cycle: {
    cycleId: string;
    model: string;
    promptConfigId?: string;
    promptConfigHash?: string;
    startedAt: string;
    endedAt: string;
  };
  candidates: RejectCandidate[];
}

export interface RejectReview {
  candidateId: string;
  reviewerRole: "primary" | "secondary";
  reviewerId: string;
  label: ReviewLabel;
  evidenceRef?: string;
}

interface RejectReviews {
  schemaVersion: typeof MAIL_AI_REJECT_GATE_SCHEMA;
  cycleId: string;
  reviews: RejectReview[];
}

interface GateIssue {
  code: string;
  candidateId?: string;
  detail: string;
}

interface MailAiRejectGateReceipt {
  schemaVersion: typeof MAIL_AI_REJECT_GATE_SCHEMA;
  status: GateStatus;
  exitCode: 0 | 1 | 2 | 64;
  cycleId?: string;
  populationCount: number;
  primaryReviewCount: number;
  secondaryReviewCount: number;
  requiredSecondaryCandidateIds: string[];
  issues: GateIssue[];
}

const CANDIDATE_TYPES = new Set<CandidateType>(["task", "opportunity", "poc"]);
const LABELS = new Set<ReviewLabel>(["actual_opportunity", "not_opportunity", "insufficient_evidence"]);
const RFC3339_WITH_OFFSET = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?<timezone>Z|(?<offsetSign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/;
const SHA256_HEX = /^[a-fA-F0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Validates every RFC3339 calendar and timezone component before Date.parse.
 * Date.parse normalizes some impossible dates, which must never make gate input valid.
 */
function validTimestamp(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  const match = RFC3339_WITH_OFFSET.exec(value);
  if (!match?.groups) return false;

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (match.groups.timezone !== "Z") {
    const offsetHour = Number(match.groups.offsetHour);
    const offsetMinute = Number(match.groups.offsetMinute);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function issue(code: string, detail: string, candidateId?: string): GateIssue {
  return candidateId === undefined ? { code, detail } : { code, detail, candidateId };
}

function exitCode(status: GateStatus): 0 | 1 | 2 | 64 {
  switch (status) {
    case "PASS": return 0;
    case "FAIL": return 1;
    case "BLOCKED": return 2;
    case "INVALID": return 64;
  }
}

export function exitCodeForMailAiRejectGate(status: GateStatus): 0 | 1 | 2 | 64 {
  return exitCode(status);
}

function receipt(
  status: GateStatus,
  fields: Omit<MailAiRejectGateReceipt, "schemaVersion" | "status" | "exitCode">,
): MailAiRejectGateReceipt {
  return { schemaVersion: MAIL_AI_REJECT_GATE_SCHEMA, status, exitCode: exitCode(status), ...fields };
}

export function invalidMailAiRejectGateReceipt(detail: string): MailAiRejectGateReceipt {
  return receipt("INVALID", {
    populationCount: 0,
    primaryReviewCount: 0,
    secondaryReviewCount: 0,
    requiredSecondaryCandidateIds: [],
    issues: [issue("INVALID_INPUT", detail)],
  });
}

function parsePopulation(value: unknown): { population?: FrozenRejectPopulation; issues: GateIssue[] } {
  const issues: GateIssue[] = [];
  if (!isRecord(value)) return { issues: [issue("INVALID_POPULATION", "Population document must be a JSON object.")] };
  if (value.schemaVersion !== MAIL_AI_REJECT_GATE_SCHEMA) issues.push(issue("SCHEMA_VERSION", "Population schemaVersion must be mail-ai-reject-gate/v1."));
  if (value.scope !== "all_ai_rejects") issues.push(issue("POPULATION_SCOPE", "Population scope must be all_ai_rejects."));
  if (value.frozen !== true) issues.push(issue("POPULATION_NOT_FROZEN", "Population frozen must be true."));
  if (!isRecord(value.cycle)) {
    issues.push(issue("INVALID_CYCLE", "Population cycle must be an object."));
  }

  const cycle = isRecord(value.cycle) ? value.cycle : {};
  const cycleId = cycle.cycleId;
  const model = cycle.model;
  const promptConfigId = cycle.promptConfigId;
  const promptConfigHash = cycle.promptConfigHash;
  const startedAt = cycle.startedAt;
  const endedAt = cycle.endedAt;
  if (!nonEmptyString(cycleId)) issues.push(issue("CYCLE_ID", "Cycle cycleId must be a non-empty string."));
  if (!nonEmptyString(model)) issues.push(issue("MODEL", "Cycle model must be a non-empty string."));
  if (!nonEmptyString(promptConfigId) && !(typeof promptConfigHash === "string" && SHA256_HEX.test(promptConfigHash))) {
    issues.push(issue("PROMPT_CONFIG", "Cycle requires a non-empty promptConfigId or SHA-256 promptConfigHash."));
  }
  if (promptConfigHash !== undefined && !(typeof promptConfigHash === "string" && SHA256_HEX.test(promptConfigHash))) {
    issues.push(issue("PROMPT_CONFIG_HASH", "promptConfigHash must be a SHA-256 hexadecimal digest when supplied."));
  }
  if (!validTimestamp(startedAt)) issues.push(issue("STARTED_AT", "Cycle startedAt must be an RFC3339 timestamp with timezone."));
  if (!validTimestamp(endedAt)) issues.push(issue("ENDED_AT", "Cycle endedAt must be an RFC3339 timestamp with timezone."));
  if (validTimestamp(startedAt) && validTimestamp(endedAt) && Date.parse(startedAt) > Date.parse(endedAt)) {
    issues.push(issue("CYCLE_TIME_RANGE", "Cycle startedAt must not be later than endedAt."));
  }

  if (!Array.isArray(value.candidates)) {
    issues.push(issue("INVALID_CANDIDATES", "Population candidates must be an array."));
    return { issues };
  }

  const candidates: RejectCandidate[] = [];
  const candidateIds = new Set<string>();
  for (const [index, raw] of value.candidates.entries()) {
    if (!isRecord(raw)) {
      issues.push(issue("INVALID_CANDIDATE", `Candidate at index ${index} must be an object.`));
      continue;
    }
    const candidateId = raw.candidateId;
    if (!nonEmptyString(candidateId)) {
      issues.push(issue("CANDIDATE_ID", `Candidate at index ${index} must have a non-empty candidateId.`));
      continue;
    }
    if (candidateIds.has(candidateId)) {
      issues.push(issue("DUPLICATE_CANDIDATE", "Population candidateId must be unique.", candidateId));
      continue;
    }
    candidateIds.add(candidateId);
    if (typeof raw.candidateType !== "string" || !CANDIDATE_TYPES.has(raw.candidateType as CandidateType)) {
      issues.push(issue("CANDIDATE_TYPE", "candidateType must be task, opportunity, or poc.", candidateId));
      continue;
    }
    if (raw.aiDecision !== "reject") {
      issues.push(issue("AI_DECISION", "Every population row must have the exact AI decision reject.", candidateId));
      continue;
    }
    if (raw.evidenceRef !== undefined && !nonEmptyString(raw.evidenceRef)) {
      issues.push(issue("CANDIDATE_EVIDENCE_REF", "evidenceRef must be an opaque non-empty string when supplied.", candidateId));
      continue;
    }
    candidates.push({
      candidateId,
      candidateType: raw.candidateType as CandidateType,
      aiDecision: "reject",
      ...(raw.evidenceRef === undefined ? {} : { evidenceRef: raw.evidenceRef }),
    });
  }

  if (issues.length > 0 || !nonEmptyString(cycleId) || !nonEmptyString(model) || !validTimestamp(startedAt) || !validTimestamp(endedAt)) {
    return { issues };
  }
  return {
    issues,
    population: {
      schemaVersion: MAIL_AI_REJECT_GATE_SCHEMA,
      scope: "all_ai_rejects",
      frozen: true,
      cycle: {
        cycleId,
        model,
        ...(nonEmptyString(promptConfigId) ? { promptConfigId } : {}),
        ...(typeof promptConfigHash === "string" && SHA256_HEX.test(promptConfigHash) ? { promptConfigHash } : {}),
        startedAt,
        endedAt,
      },
      candidates,
    },
  };
}

function parseReviews(value: unknown, population: FrozenRejectPopulation): { reviews?: RejectReviews; issues: GateIssue[] } {
  const issues: GateIssue[] = [];
  if (!isRecord(value)) return { issues: [issue("INVALID_REVIEWS", "Reviews document must be a JSON object.")] };
  if (value.schemaVersion !== MAIL_AI_REJECT_GATE_SCHEMA) issues.push(issue("SCHEMA_VERSION", "Reviews schemaVersion must be mail-ai-reject-gate/v1."));
  if (value.cycleId !== population.cycle.cycleId) issues.push(issue("REVIEW_CYCLE_ID", "Reviews cycleId must exactly match the frozen population cycleId."));
  if (!Array.isArray(value.reviews)) {
    issues.push(issue("INVALID_REVIEWS", "Reviews reviews must be an array."));
    return { issues };
  }

  const candidates = new Set(population.candidates.map((candidate) => candidate.candidateId));
  const reviewKeys = new Set<string>();
  const reviews: RejectReview[] = [];
  for (const [index, raw] of value.reviews.entries()) {
    if (!isRecord(raw)) {
      issues.push(issue("INVALID_REVIEW", `Review at index ${index} must be an object.`));
      continue;
    }
    const candidateId = raw.candidateId;
    const reviewerRole = raw.reviewerRole;
    if (!nonEmptyString(candidateId)) {
      issues.push(issue("REVIEW_CANDIDATE_ID", `Review at index ${index} must have a non-empty candidateId.`));
      continue;
    }
    if (!candidates.has(candidateId)) {
      issues.push(issue("EXTRA_REVIEW", "Review candidateId is not in the frozen population.", candidateId));
      continue;
    }
    if (reviewerRole !== "primary" && reviewerRole !== "secondary") {
      issues.push(issue("REVIEWER_ROLE", "reviewerRole must be primary or secondary.", candidateId));
      continue;
    }
    const reviewKey = `${candidateId}\u0000${reviewerRole}`;
    if (reviewKeys.has(reviewKey)) {
      issues.push(issue("DUPLICATE_REVIEW", "A candidate may have at most one review for each reviewerRole.", candidateId));
      continue;
    }
    reviewKeys.add(reviewKey);
    if (!nonEmptyString(raw.reviewerId)) {
      issues.push(issue("REVIEWER_ID", "reviewerId must be a non-empty opaque string.", candidateId));
      continue;
    }
    if (typeof raw.label !== "string" || !LABELS.has(raw.label as ReviewLabel)) {
      issues.push(issue("REVIEW_LABEL", "label must be actual_opportunity, not_opportunity, or insufficient_evidence.", candidateId));
      continue;
    }
    if (raw.evidenceRef !== undefined && !nonEmptyString(raw.evidenceRef)) {
      issues.push(issue("REVIEW_EVIDENCE_REF", "evidenceRef must be an opaque non-empty string when supplied.", candidateId));
      continue;
    }
    reviews.push({
      candidateId,
      reviewerRole,
      reviewerId: raw.reviewerId,
      label: raw.label as ReviewLabel,
      ...(raw.evidenceRef === undefined ? {} : { evidenceRef: raw.evidenceRef }),
    });
  }
  if (issues.length > 0) return { issues };
  return { issues, reviews: { schemaVersion: MAIL_AI_REJECT_GATE_SCHEMA, cycleId: population.cycle.cycleId, reviews } };
}

/** Stable ascending SHA-256 rank; ties are broken by candidateId for completeness. */
export function selectSecondaryNotOpportunitySample(cycleId: string, candidateIds: readonly string[]): string[] {
  const uniqueIds = [...new Set(candidateIds)];
  const count = Math.ceil(uniqueIds.length * 0.1);
  return uniqueIds
    .map((candidateId) => ({ candidateId, rank: createHash("sha256").update(`${cycleId}:${candidateId}`).digest("hex") }))
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.candidateId.localeCompare(right.candidateId))
    .slice(0, count)
    .map(({ candidateId }) => candidateId);
}

export function evaluateMailAiRejectGate(populationInput: unknown, reviewsInput: unknown): MailAiRejectGateReceipt {
  const parsedPopulation = parsePopulation(populationInput);
  if (!parsedPopulation.population) {
    return receipt("INVALID", {
      populationCount: 0,
      primaryReviewCount: 0,
      secondaryReviewCount: 0,
      requiredSecondaryCandidateIds: [],
      issues: parsedPopulation.issues,
    });
  }
  const population = parsedPopulation.population;
  const parsedReviews = parseReviews(reviewsInput, population);
  if (!parsedReviews.reviews) {
    return receipt("INVALID", {
      cycleId: population.cycle.cycleId,
      populationCount: population.candidates.length,
      primaryReviewCount: 0,
      secondaryReviewCount: 0,
      requiredSecondaryCandidateIds: [],
      issues: parsedReviews.issues,
    });
  }

  const primaryByCandidate = new Map<string, RejectReview>();
  const secondaryByCandidate = new Map<string, RejectReview>();
  for (const review of parsedReviews.reviews.reviews) {
    (review.reviewerRole === "primary" ? primaryByCandidate : secondaryByCandidate).set(review.candidateId, review);
  }

  const gateIssues: GateIssue[] = [];
  for (const candidate of population.candidates) {
    if (!primaryByCandidate.has(candidate.candidateId)) {
      gateIssues.push(issue("MISSING_PRIMARY_REVIEW", "Every population row requires one primary review.", candidate.candidateId));
    }
  }

  const sampledNotOpportunities = selectSecondaryNotOpportunitySample(
    population.cycle.cycleId,
    population.candidates
      .map((candidate) => primaryByCandidate.get(candidate.candidateId))
      .filter((review): review is RejectReview => review?.label === "not_opportunity")
      .map((review) => review.candidateId),
  );
  const requiredSecondary = new Set(sampledNotOpportunities);
  for (const candidate of population.candidates) {
    const primary = primaryByCandidate.get(candidate.candidateId);
    if (primary?.label === "actual_opportunity" || primary?.label === "insufficient_evidence") {
      requiredSecondary.add(candidate.candidateId);
    }
  }
  const requiredSecondaryCandidateIds = [...requiredSecondary].sort();

  for (const [candidateId, secondary] of secondaryByCandidate) {
    const primary = primaryByCandidate.get(candidateId);
    if (!primary) continue;
    if (primary.reviewerId === secondary.reviewerId) {
      return receipt("INVALID", {
        cycleId: population.cycle.cycleId,
        populationCount: population.candidates.length,
        primaryReviewCount: primaryByCandidate.size,
        secondaryReviewCount: secondaryByCandidate.size,
        requiredSecondaryCandidateIds,
        issues: [issue("NONINDEPENDENT_SECONDARY_REVIEW", "Primary and secondary reviewerId must differ.", candidateId)],
      });
    }
    if (primary.label !== secondary.label) {
      gateIssues.push(issue("LABEL_MISMATCH", "Primary and secondary labels must match.", candidateId));
    }
  }
  for (const candidateId of requiredSecondaryCandidateIds) {
    const primary = primaryByCandidate.get(candidateId);
    const secondary = secondaryByCandidate.get(candidateId);
    if (!secondary) {
      gateIssues.push(issue("MISSING_SECONDARY_REVIEW", "This row requires a secondary review.", candidateId));
      continue;
    }
  }

  const allLabels = parsedReviews.reviews.reviews.map((review) => review.label);
  if (allLabels.includes("actual_opportunity")) {
    return receipt("FAIL", {
      cycleId: population.cycle.cycleId,
      populationCount: population.candidates.length,
      primaryReviewCount: primaryByCandidate.size,
      secondaryReviewCount: secondaryByCandidate.size,
      requiredSecondaryCandidateIds,
      issues: gateIssues,
    });
  }
  if (allLabels.includes("insufficient_evidence")) {
    gateIssues.push(issue("INSUFFICIENT_EVIDENCE", "An insufficient_evidence label blocks closure."));
  }
  return receipt(gateIssues.length === 0 ? "PASS" : "BLOCKED", {
    cycleId: population.cycle.cycleId,
    populationCount: population.candidates.length,
    primaryReviewCount: primaryByCandidate.size,
    secondaryReviewCount: secondaryByCandidate.size,
    requiredSecondaryCandidateIds,
    issues: gateIssues,
  });
}
