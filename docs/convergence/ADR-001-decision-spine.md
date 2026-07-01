# ADR-001 — Canonical Decision Spine

- **Status:** Accepted — FROZEN (v5, survived all 5 red-team rounds; see PLAN.md § Red-team convergence log)
- **Date:** 2026-07-02
- **Branch:** `feat/decision-spine-convergence` (integration HEAD `ec3f5b4`)
- **Deciders:** convergence initiative
- **Supersedes:** the informal "DomainDecisionLog is de-facto the target" assumption in the S1 substrate.

---

## Context

The "업무자동화 OS" work-automation product rests on one philosophy: **every human correction must be
captured → land in ONE place the AI reads before it generates → eventually automate the human step.**
That philosophy is only worth anything if the signal *converges*. Today it does not.

### The mess (verified against code)
- **Four physical decision tables**, no declared owner:
  `agent_decision_logs` (schema.prisma:297, 15 rows), `policy_decision_logs` (:1421, **1898 rows**),
  `domain_decision_logs` (:1501, **7 rows**), `color_agent_decisions` (:2492, 0 rows).
- **`domain_decision_logs` is double-purposed**: a GTM-domain log (original columns
  `domain/caseRef/decisionType/humanEditJson/outcome`, read by `domain-dashboard.ts:143`) AND the S1
  universal decision sink (nullable `actor/actionType/riskTier/policyVersion/predictedConfidence`,
  written by `recordDecision`).
- **Two writers to the canonical table with different contracts**: `recordDecision()`
  (`ai-decision.ts:56`, gate-stamped) and `recordDomainDecision()` (`domain-memory.ts:147`, no gate,
  legacy columns only).
- **A third, orphaned governance layer**: `origin/polish-clean`'s
  `packages/mail-intelligence/src/contract.ts` (`MailClassificationDecision`/`computeMailUncertainty`/
  `projectMailCandidateType`) imports no prisma, calls no `recordDecision`, and has zero importers.
- **Branch divergence on the exact write path**: `main`'s `mail-candidates.ts` has the S1
  `recordDecision` block; both feature branches (and `polish-clean`) have it DELETED (0 refs).
- **Live data safety**: 1898 audit rows, 1164 mail candidates, 66 customers, 54 opportunities
  (Σ ₩500,506,938). DB is managed by **formal Prisma migrations** (`db:migrate:deploy`), NOT `db push`
  (CORRECTION to the initiative brief). Destructive migration = data loss.

### Red-team-surfaced hazards on the integration HEAD (design-twice forced by these)
- HEAD carries **committed, unresolved git conflict markers** in two portal pages → `pnpm -w typecheck`
  currently FAILS. "Baseline green" was a false premise.
- Four API routes have a **duplicate, unauthenticated `DELETE` handler** that shadows the guarded one
  → a live unauthenticated hard-delete of CRM data, with `archive*()` calling `prisma.*.delete`.
- The claimed "negative learning" does **not** influence recall (`recallDomainMemories` scores
  candidates independently; a rejected memory is merely dropped, it cannot suppress a positive), and
  `buildMemoryTags` (bdcf333) is used only at the write site while all three recall sites pass raw
  tags — so even approved memories are unrecallable.

---

## Decision

### D1 — ONE canonical decision table: `domain_decision_logs`, written ONLY via `recordDecision()`
`recordDecision()` (`packages/business/src/ai-decision.ts:56`) is the sole sanctioned writer. It is the
only path that stamps `actor/actionType/riskTier/policyVersion` through the fail-closed gate
(`ai-decision-policy.ts:81`; unregistered `actionType` → T2), which is the prerequisite for confidence
calibration and future autonomy promotion. All NEW decisions — CRUD edits, archives, mail verdicts —
route through it. Chosen because it already carries the superset S1 vocabulary and holds the (nascent,
7-row) canonical data; growing it is a write-path redirect, not a migration.

### D2 — Deprecate-not-drop for redundant tables/writers
`policy_decision_logs` (1898 rows) becomes legacy mail/ingest audit; `agent_decision_logs` a
workflow-agent trace; `color_agent_decisions` an unused kanban stub. Their writers get `@deprecated`
doc-comments (**both** `policyDecisionLog.create` sites — `mail-candidates.ts:1055` and
`mail-insight-threads.ts:252` — plus `workflow-runner.ts:49` and the second canonical-table writer
`domain-memory.ts:147`). **No table dropped, no column renamed, all rows preserved read-only.** Actual
removal is a separate, later, reviewed migration.

### D3 — Correlation invariant via ONE canonical `caseRef` prefix per entity
An AI decision row and its human-correction row MUST share `caseRef` so a single `{caseRef}` query
returns the pair. We adopt the **already-load-bearing short prefixes** as canonical
(`opp:`, `eng:`, `mail_candidate:`, and by extension `cust:/partner:/task:/proposal:/poc:`), centralized
in `caseRefFor()`. This corrects an earlier self-contradiction where new edit/archive writers were to
use `'opportunity:'+id` while three existing spine writes use `'opp:'+id` in the same file — which
would silently break pairing. Every new writer uses `caseRefFor`; the three existing `'opp:'` sites and
the `'eng:'` read/write pair are already conformant.

### D4 — Mail contract is a DEFERRED vocabulary, wired additively (this pass = no-op)
The rich `MailClassificationDecision` contract is NOT ported this pass: HEAD's `contract.ts` is already
the minimal stub, `classifiedType` is referenced 0×, and porting would clobber the working stub to
net-add nothing. When wired (follow-up), the contract becomes the classification *vocabulary* whose
`computeMailUncertainty`/`projectMailCandidateType` feed `recordDecision` — the contract persists
nothing itself; `recordDecision` remains the sole sink.

### D5 — Honest scope: this pass converges the AUDIT spine, not the LEARNING loop
Exactly ONE recall down-payment ships: the **tag-symmetry fix** (recall queries use `buildMemoryTags`,
matching the write side) so approved/corrected engagement memories become recallable by the actual
consumers. **We explicitly do NOT claim** that: (a) engagement *rejection* suppresses a positive recall
(the recall math has no cross-candidate logic — it would need same-case-key grouping); (b) field-edit
corrections change AI reads; (c) mail rejections down-weight symmetrically. Those are named gaps
(PLAN §7). Copy must not assert negative learning fires where the recall math cannot express it.

### D6 — No destructive schema change; additive migrations only
Nullable `ADD COLUMN` (`archivedAt`), `CREATE INDEX`, `CREATE TYPE` only. Deploy ordering is an
invariant: migrate the live DB (additive, always safe) BEFORE deploying code that references the new
column.

---

## Alternatives considered (design-twice)

| Option | Description | Why rejected |
|---|---|---|
| **A. Make `policy_decision_logs` the spine** | It has 1898 rows — the most data. | It lacks the gate vocabulary (`riskTier/actor/actionType`); it is an audit log, not a governed-decision log. Retro-fitting the gate onto 1898 heterogeneous rows is riskier than growing the 7-row purpose-built table. |
| **B. New unified table (`ai_decision_logs`), migrate all four in** | Clean slate, one owner. | Requires a data migration of 1920+ live rows across incompatible schemas → exactly the destructive migration the data-safety constraint forbids this pass. Deferred as the eventual endgame. |
| **C. Keep the polish-clean contract as the persistence layer** | It has the richest taxonomy. | It persists NOTHING (no prisma, no importers) and merging its branch DELETES the only mail→spine link. It is a vocabulary, not a sink. |
| **D. Two writers to `domain_decision_logs` (status quo)** | Least code change. | `recordDomainDecision` bypasses the gate → un-tiered rows pollute calibration. Convergence's whole point is one contract. |
| **E. Rename the DB `domain` column to disambiguate now** | Fixes semantic overload immediately. | Column RENAME in Postgres = drop+add = data loss on live columns. Use Prisma `@map` field-rename instead (empty SQL diff), and defer even that as orthogonal. |
| **F. Merge feature branches into main** | Simplest git-wise. | Both are 101/33 commits stale; a naive merge reintroduces the pre-S1 `mail-candidates.ts` (0 recordDecision) and strips the spine. Rebase/cherry-pick unique commits instead. |

---

## Consequences (ATAM-style: what this buys, what it risks)

### Positive
- One place to read the human signal: calibration/recall can query a single stream keyed by `caseRef`.
- The fail-closed gate now covers every new decision surface (edits, archives) — unregistered actions
  fail to T2 (human review), which is the safe default.
- Data is untouched: 1898+7+66+54 rows survive; convergence is a write-path redirect.
- The live unauthenticated CRM-delete vulnerability is closed as a *precondition* of the delete UX,
  not an afterthought.

### Negative / risks and mitigations
| Risk | Sensitivity | Mitigation |
|---|---|---|
| **R1 Baseline non-compiling** (committed conflict markers) blocks everything. | HIGH | PLAN Step 0 runs first; CI gate 1 (`! git grep <<<<<<<`) + gate 2 (typecheck) make regression impossible. |
| **R2 Unauthenticated hard-delete** of a ₩500M opportunity is LIVE now. | CRITICAL | PLAN Step 1 removes the duplicate/unauthed handler before any delete work; gate 3 asserts one DELETE export; integration test asserts 401/403. |
| **R3 caseRef mismatch** silently breaks learning pairing. | HIGH | D3 pins one prefix; gates 6–7 assert uniformity + pairing. |
| **R4 Losing the mail→spine block** on a bad `mail-candidates.ts` merge. | HIGH | Conflict rule: always keep the side containing `recordDecision`; gate 4 asserts count ≥ 1. |
| **R5 Overclaiming learning** convergence. | MED (trust) | D5 states audit-only scope; gate 9 (suppression probe) is a `test.todo` that MUST fail on current code, preventing a false "negative learning works" sign-off. |
| **R6 Migrate-after-deploy** breaks the archive path. | MED (availability) | D6 deploy-ordering invariant: additive migration first, always safe. |
| **R7 Gate-coverage false failures** from grepping deprecated `decisionType` literals. | LOW | Gate 5 scoped to `recordDecision(actionType:)` only; excludes `recordPolicyDecision` args. |
| **R8 Semantic overload of `domain`** persists this pass. | LOW | Accepted; `@map` field-rename deferred (PLAN §7), zero-SQL when done. |

### Merge-safety note (corrected)
The integration HEAD is a **re-authored superset** of `feat-ax-overhaul`, not "byte-identical."
`git cherry` is the wrong instrument (marks all 8 ax commits `+`). Correctness is proven by per-file
`git diff HEAD origin/feat-ax-overhaul` on the specific UI components plus a real typecheck — never by
symbol-count greps, which pass on conflicted, non-compiling files.

### Follow-up (the endgame this ADR sets up, not delivered here)
Option B (single `ai_decision_logs` table, migrate the four in) once the write path has demonstrably
moved to `domain_decision_logs`; god-file decomposition behind the mail contract; real same-case-key
suppression in `recallDomainMemories`; symmetric mail-rejection down-weighting;
`domain` → `gtmDomain`/`emailDomain` `@map` disambiguation.
