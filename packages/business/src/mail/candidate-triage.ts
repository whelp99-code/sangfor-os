/**
 * Close the mail-learning feedback loop.
 *
 * `learnFromMailbox` only runs forward (mail -> proposed candidates), so every
 * candidate the pipeline emits waits for a human and the queue grows without
 * bound. This module runs the missing reverse direction: it reads the decisions
 * humans already made and derives the disposition rules those decisions imply,
 * then applies them to the pending backlog.
 *
 * Governance (AGENTS.md Quick Rule 3 — AI output is a draft):
 * an automated decision here NEVER creates a business record. The only status an
 * automated decision may assign is `knowledge_only`, which keeps the candidate
 * searchable as knowledge and is reversible. Conversions — the direction that
 * writes CRM entities — always stay with a human.
 */

export type CandidateType = "customer" | "partner" | "task" | "opportunity" | "poc";
export type DecidedStatus = "converted" | "rejected" | "knowledge_only";

export interface DecidedCandidate {
  readonly candidateType: CandidateType;
  readonly confidence: number;
  readonly status: DecidedStatus;
  readonly title: string;
}

export interface PendingCandidate {
  readonly id: string;
  readonly candidateType: CandidateType;
  readonly confidence: number;
  readonly title: string;
}

export interface DispositionRules {
  /** Confidence below which humans have never once converted, or null when unproven. */
  readonly confidenceFloor: number | null;
  /** Candidate types humans have never once converted. */
  readonly neverConvertingTypes: readonly CandidateType[];
}

export type TriageRule =
  | "low_confidence"
  | "never_converts"
  | "already_converted"
  | "known_entity"
  | "duplicate_of_pending";

export interface TriageDecision {
  readonly id: string;
  readonly nextStatus: "knowledge_only";
  readonly rule: TriageRule;
  readonly evidence: string;
}

export interface TriagePlan {
  readonly decisions: readonly TriageDecision[];
  readonly humanReview: readonly PendingCandidate[];
}

/**
 * A rule is only trusted once enough decisions back it. Below this the sample is
 * noise and we leave the candidates to a human rather than invent a threshold.
 */
const MIN_SAMPLE = 20;

const CONFIDENCE_STEPS = [70, 80, 90] as const;

export function titleKey(candidateType: string, title: string): string {
  return `${candidateType.toLowerCase()}\u0000${title.trim().toLowerCase()}`;
}

export function learnDispositionRules(history: readonly DecidedCandidate[]): DispositionRules {
  let confidenceFloor: number | null = null;
  for (const step of CONFIDENCE_STEPS) {
    const below = history.filter((c) => c.confidence < step);
    if (below.length < MIN_SAMPLE) continue;
    if (below.some((c) => c.status === "converted")) continue;
    confidenceFloor = step;
  }

  const byType = new Map<CandidateType, DecidedCandidate[]>();
  for (const candidate of history) {
    const bucket = byType.get(candidate.candidateType) ?? [];
    bucket.push(candidate);
    byType.set(candidate.candidateType, bucket);
  }

  const neverConvertingTypes = [...byType.entries()]
    .filter(([, rows]) => rows.length >= MIN_SAMPLE && rows.every((r) => r.status !== "converted"))
    .map(([type]) => type);

  return { confidenceFloor, neverConvertingTypes };
}

export function buildTriagePlan(input: {
  readonly pending: readonly PendingCandidate[];
  readonly rules: DispositionRules;
  /** `titleKey` values of candidates a human already converted. */
  readonly convertedTitles: ReadonlySet<string>;
  /** Active policy-memory keys naming entities the org already knows. */
  readonly knownPolicyKeys: readonly string[];
}): TriagePlan {
  const { pending, rules, convertedTitles, knownPolicyKeys } = input;
  const decisions: TriageDecision[] = [];
  const survivors: PendingCandidate[] = [];

  for (const candidate of pending) {
    if (rules.confidenceFloor !== null && candidate.confidence < rules.confidenceFloor) {
      decisions.push({
        id: candidate.id,
        nextStatus: "knowledge_only",
        rule: "low_confidence",
        evidence: `confidence ${candidate.confidence} < learned floor ${rules.confidenceFloor}; humans never converted below it`,
      });
      continue;
    }

    if (rules.neverConvertingTypes.includes(candidate.candidateType)) {
      decisions.push({
        id: candidate.id,
        nextStatus: "knowledge_only",
        rule: "never_converts",
        evidence: `type ${candidate.candidateType} has never been converted by a human`,
      });
      continue;
    }

    if (convertedTitles.has(titleKey(candidate.candidateType, candidate.title))) {
      decisions.push({
        id: candidate.id,
        nextStatus: "knowledge_only",
        rule: "already_converted",
        evidence: `an identical ${candidate.candidateType} candidate was already converted`,
      });
      continue;
    }

    const known = knownPolicyKeys.find(
      (key) => key.length > 0 && candidate.title.toLowerCase().includes(key.toLowerCase()),
    );
    if (known) {
      decisions.push({
        id: candidate.id,
        nextStatus: "knowledge_only",
        rule: "known_entity",
        evidence: `policy memory already knows "${known}"`,
      });
      continue;
    }

    survivors.push(candidate);
  }

  // Collapse duplicates among what is left so a human decides each entity once,
  // keeping the highest-confidence row as the representative.
  const best = new Map<string, PendingCandidate>();
  for (const candidate of survivors) {
    const key = titleKey(candidate.candidateType, candidate.title);
    const incumbent = best.get(key);
    if (!incumbent || candidate.confidence > incumbent.confidence) best.set(key, candidate);
  }

  const humanReview: PendingCandidate[] = [];
  for (const candidate of survivors) {
    const key = titleKey(candidate.candidateType, candidate.title);
    if (best.get(key)?.id === candidate.id) {
      humanReview.push(candidate);
      continue;
    }
    decisions.push({
      id: candidate.id,
      nextStatus: "knowledge_only",
      rule: "duplicate_of_pending",
      evidence: `duplicate of pending ${candidate.candidateType} "${candidate.title}"`,
    });
  }

  return { decisions, humanReview };
}
