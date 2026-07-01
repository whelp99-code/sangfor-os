/**
 * case-ref.ts — canonical `caseRef` prefixes for the decision spine.
 *
 * A decision row (`recordDecision`) and its paired human-correction row MUST share
 * the same `caseRef`, so a single `{ caseRef }` query returns the pair
 * (ADR-001 §D3 — correlation invariant). This module is the ONE source of truth
 * for the prefix per entity: every spine writer calls `caseRefFor(entity, id)`
 * instead of inlining a literal, so prefixes never drift (e.g. `opp:` vs
 * `opportunity:`) and learning-pair correlation never silently breaks.
 *
 * The prefixes below match the load-bearing sites that already exist
 * (opportunity-center → `opp:`, project-decision/domain-proposal → `eng:`,
 * mail-candidates revalidation → `mail_candidate:`), so they are adopted AS
 * canonical rather than rewritten.
 */
export type CaseRefEntity =
  | "opportunity"
  | "engagement"
  | "mailCandidate"
  | "customer"
  | "partner"
  | "task"
  | "proposal"
  | "poc";

const CASE_REF_PREFIX: Readonly<Record<CaseRefEntity, string>> = Object.freeze({
  opportunity: "opp:",
  engagement: "eng:",
  mailCandidate: "mail_candidate:",
  customer: "cust:",
  partner: "partner:",
  task: "task:",
  proposal: "proposal:",
  poc: "poc:",
});

/**
 * Canonical `caseRef` for an entity id.
 * @example caseRefFor("opportunity", id) === `opp:${id}`
 */
export function caseRefFor(entity: CaseRefEntity, id: string): string {
  return `${CASE_REF_PREFIX[entity]}${id}`;
}
