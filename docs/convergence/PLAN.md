# Decision-Spine Convergence — Implementation Plan

Branch: `feat/decision-spine-convergence` (worktree `/Users/jmpark/Playground/sangfor-os/.worktrees/convergence`), off `main`.
Integration HEAD at authoring time: `ec3f5b4`.

---

## Red-team convergence log

This plan and its companion **ADR-001** survived **5 adversarial red-team rounds** (the process cap)
and are now FROZEN for execution. Each round attacked the prior draft and forced a correction; the
plan converged rather than diverged — the final round surfaced no new HIGH/CRITICAL contradiction, only
citation-precision fixes. Every premise below was re-verified against the tree at HEAD `ec3f5b4` on
2026-07-02 (see the `VERIFIED` tags in §1 and the CI gates in §6).

| Round | Adversarial finding | Correction landed |
|---|---|---|
| 1 | "Baseline is green / HEAD == origin/feat-ax-overhaul." | FALSE — committed conflict markers, typecheck fails. Added **Step 0** (resolve first). (P1) |
| 2 | "Port the polish-clean mail contract (Step 3)." | It is a true no-op (stub already minimal, `classifiedType` 0 refs). **Step 3 demoted to a no-op assertion.** (P2) |
| 3 | "Delete UI is safe; DELETE routes require auth." | FALSE + CRITICAL — duplicate unauthenticated `DELETE` shadows the guarded one; `archive*` hard-deletes CRM data. Added **Step 1** before any delete-UX. (P4) |
| 4 | "Negative learning works; caseRef canonicalization is fine." | FALSE — recall has no cross-candidate suppression; new writers used `'opportunity:'+id` while live sites use `'opp:'+id`. Reframed **Step 8** (tag-symmetry only) + **Step 4** (pin `caseRefFor`). (P5, P6) |
| 5 | "Gate-coverage grep will pass; DB is `db push`." | Grep-everything gave guaranteed false failures → **Gate 5 scoped to `recordDecision(actionType:)`**. DB uses formal migrations, not `db push` → §8 corrected; additive-only constraint made explicit. (P3, P8) |

**Invariant that survived all 5 rounds (do not weaken):** this convergence is **ADDITIVE** —
no `DROP TABLE/COLUMN`, no live-column RENAME, no non-null `ADD COLUMN` without default, no
`db push --accept-data-loss`. It converges the **write path** and marks redundant tables/writers
`@deprecated`; all live rows are preserved read-only. Actual table removal is a separate, later,
reviewed migration (§8, ADR-001 D2/D6).

> This is **v5** of the plan — **FROZEN** after the 5-round red-team cap (see § Red-team convergence
> log above). It supersedes prior drafts and hard-corrects several false premises the earlier drafts
> carried (baseline was NOT green; contract port was a no-op; caseRef canonicalization contradicted
> itself; an unauthenticated hard-delete of CRM data is LIVE on HEAD; "negative learning" does not
> actually influence recall). Every claim below was re-verified against the tree at HEAD `ec3f5b4` on
> 2026-07-02 — see the inline `VERIFIED` tags.

---

## 0. Goal & Non-Goals

### Goal
Converge the fragmented decision-and-learning substrate onto **ONE canonical write path** so that
every AI decision and every human correction is captured in a single place the AI can later read.
Concretely:
1. Declare **one canonical decision table** (`domain_decision_logs`, written **only** via
   `recordDecision()` in `packages/business/src/ai-decision.ts`) — see ADR-001.
2. Redirect all NEW decision writes onto that spine; mark the redundant tables/writers
   **DEPRECATED (not dropped)**.
3. Land the `feat-ax-overhaul` user-convenience slice (My Work view, CRUD, ko i18n, learning-loop
   fix) onto a **green, conflict-free** base, with its new delete/edit paths routed through the spine.
4. Wire `polish-clean`'s mail-intelligence contract **additively** (as vocabulary feeding
   `recordDecision`), not as a parallel layer — **or defer it** if it proves to be a true no-op.

### Non-Goals (explicit)
- **NO destructive schema migration this pass.** No `DROP TABLE`, no `DROP COLUMN`, no column
  RENAME on live columns, no non-nullable `ADD COLUMN` without default, no
  `db push --accept-data-loss`. DB is managed by **formal Prisma migrations** now
  (`db:migrate:deploy`, CORRECTION vs the task brief — see §8 Data-safety), with 1898
  `policy_decision_logs`, 1164 `mail_derived_candidates`, 66 customers, 54 opportunities
  (Σ ₩500,506,938) live. Only additive migrations (nullable `ADD COLUMN` + `CREATE INDEX` +
  `CREATE TYPE`) are permitted.
- **NO god-file decomposition this pass.** `packages/business/src/mail-candidates.ts` (2288 lines)
  stays intact behind the barrel; decomposition is deferred to a follow-up (§5 rationale, §7 register)
  because it is
  behavior-preserving and orthogonal to the spine/data-safety goal.
- **NO claim that the learning LOOP converges this pass.** This pass converges the **AUDIT spine**.
  Exactly ONE recall down-payment (the tag-symmetry fix, Step 8) is pulled forward. All other
  human-correction surfaces (field edits, mail rejections, engagement-rejection *suppression*)
  remain audit-only and are enumerated as gaps in §7. See ADR-001 Consequences.

---

## 1. Corrected premises (what earlier drafts got wrong — do not silently repeat them)

| # | Earlier (false) premise | VERIFIED reality on `ec3f5b4` | Where fixed |
|---|---|---|---|
| P1 | HEAD is "byte-identical to origin/feat-ax-overhaul" and baseline `pnpm -w typecheck` is green. | **FALSE.** HEAD has **committed unresolved conflict markers**: `customers/[id]/page.tsx` (2 `<<<<<<<` markers), `opportunities/[id]/page.tsx` (1). `git status` is clean → they are committed. Typecheck FAILS (TS1185). `git grep -lE '^<<<<<<< ' HEAD` → both files. | **Step 0 (mandatory, runs first)** |
| P2 | Step 3 = "git checkout origin/polish-clean -- contract.ts then trim". | **Wrong/risky.** HEAD's `contract.ts` is already the minimal 5-type stub (39 lines). `classifiedType` is referenced **0 times** in `packages/business` + `apps/web`. → **true no-op**. | **Step 3 demoted to a no-op assertion** |
| P3 | Only `recordPolicyDecision` (mail-candidates) + `workflow-runner.ts` write the deprecated audit table. | Incomplete. **Two** direct `policyDecisionLog.create` writers: `mail-candidates.ts:1055` (`recordPolicyDecision`) AND `mail-insight-threads.ts:252` (`thread_ingested`). `recordPolicyDecision(` call count in mail-candidates = **10**, not 13. | **Step 5 + §7 enumerate both** |
| P4 | Delete UI is safe; DELETE routes "already require auth". | **FALSE + CRITICAL.** 4 routes (`tasks`, `opportunities`, `poc`, `proposals`) have **TWO** `export async function DELETE` handlers each; the 2nd shadows the 1st and is **unauthenticated**. `archiveOpportunity`/`archiveWorkTask` currently call `prisma.opportunity.delete` / `prisma.workTask.delete` → **live unauthenticated hard-delete of a ₩500M CRM entity**. | **Step 1 (auth/dup fix, before delete-UX work)** |
| P5 | "engagement negative learning finally works" / rejected memory "suppresses" a positive recall. | **FALSE.** `recallDomainMemories` scores each candidate independently then `.filter(score>0)` (`domain-memory.ts:71-72`) — zero cross-candidate logic. A rejected memory is merely dropped; it cannot suppress a separate positive. **Also**, `buildMemoryTags` does not even exist on this HEAD yet (bdcf333 not applied). | **Step 8 reframed as tag-symmetry only; §7 for real suppression** |
| P6 | bdcf333's `buildMemoryTags` guarantees write/recall symmetry. | Only at the **write** site. Recall queries pass RAW tags (`domain-proposal.ts:97` `[input.domain, input.engagementName]`; `domain-agent-runtime.ts:142` `c.tags`; `domain-embedding.ts:95` `input.tags`). Exact-match overlap → `'domain:sales'` never matches `'sales'`. Even approved memories are unrecallable. | **Step 8 migrates the 3 recall sites** |
| P7 | `scripts/pr-auto-merge.sh` guards main. | **Does not exist** (`git ls-files` → NOT TRACKED). Safety of main must not rest on it. | **Step -1 (branch protection, not a missing file)** |
| P8 | DB is `db push`, not migrate. | STALE. Real migrations dir exists; CI runs `db:migrate:deploy`. Constraint is still real but the mechanism is "additive migration file", not "avoid migrations". | §8 Data-safety |

---

## 2. Ordered, independently-shippable steps

Each step lists: **files**, **why**, **verify** (exact command), **rollback**, **risk**, **auto-merge?**
"SAM" = safe-to-auto-merge. "NHR" = needs-human-review.

Global verify (run after every code step):
```bash
cd /Users/jmpark/Playground/sangfor-os/.worktrees/convergence
pnpm -w typecheck
! git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- apps packages   # zero conflict markers
```

---

### Step 0 — Resolve committed conflict markers; establish the TRUE green baseline `[NHR]` `[risk: HIGH]`
**Runs FIRST, before everything else.** Earlier drafts' "baseline green" gate cannot pass until this is done.

- **Files:**
  - `apps/web/src/app/(portal)/customers/[id]/page.tsx` (2 marker regions)
  - `apps/web/src/app/(portal)/opportunities/[id]/page.tsx` (1 marker region)
- **Why:** The S1 `CustomerHubHeader` refactor collided with ax's `9c896d9` flat-layout +
  `EntityEditSheet`/`DeleteEntityButton`; the merge was committed **unresolved**. This is a real
  semantic collision, not a whitespace artifact.
- **Resolution rule (do NOT "take both raw sides"):** keep the **S1 `CustomerHubHeader` / hub layout**
  as the page structure AND **graft the ax CRUD controls** (`EntityEditSheet`, `DeleteEntityButton`)
  *into* that layout. Delete both `<<<<<<<`/`=======`/`>>>>>>>` lines and the stale flat-layout side.
- **Verify:**
  ```bash
  ! git grep -nE '^(<<<<<<<|=======|>>>>>>>)' HEAD -- apps packages   # MUST be empty
  pnpm -w typecheck                                                   # MUST pass
  ```
  Do **not** use `grep -c DeleteEntityButton >= N` as a correctness gate — it counts symbols
  inside conflict markers and gives a false "already wired" signal on a non-compiling file.
- **Rollback:** `git checkout ec3f5b4 -- <the two files>` (returns to the broken-but-known state).
- **Auto-merge:** **NHR** — human must eyeball the merged layout renders.

---

### Step -1 — Protect `main` during the multi-PR window `[NHR]` `[risk: MED]`
- **Files:** none in-repo (GitHub settings + PR #42 state).
- **Why:** P7 — the assumed `scripts/pr-auto-merge.sh` guard does not exist. Do not rely on
  "a CONFLICTING PR is never green."
- **Actions (do all three, independent of any script):**
  1. `gh pr ready 42 --undo` (convert PR #42 to **draft**).
  2. `gh pr edit 42 --add-label "blocked:convergence"` (blocking label).
  3. Re-point PR #42 base to the integration branch, not `main`:
     `gh pr edit 42 --base feat/decision-spine-convergence`.
  4. Ensure `main` has a required status check (the CI guard in §6) via branch protection;
     if branch protection is not accessible, the draft+label+rebased-base combination is the
     fallback that keeps any auto-merge mechanism from selecting #42.
- **Verify:** `gh pr view 42 --json isDraft,baseRefName,labels` shows draft=true, base=convergence.
- **Rollback:** `gh pr ready 42`, restore base to `main`.
- **Auto-merge:** **NHR**.

---

### Step 1 — Remove the LIVE unauthenticated hard-delete path `[NHR]` `[risk: CRITICAL]`
**Must land before ANY delete-UX or soft-delete work (Step 7).** Soft-delete safety is meaningless
while an unauthenticated handler is the live one.

- **Files (each has a duplicate `DELETE` export; keep only the `assertApiAccess`-guarded one):**
  - `apps/web/src/app/api/tasks/[id]/route.ts` (2 → 1)
  - `apps/web/src/app/api/opportunities/[id]/route.ts` (2 → 1)
  - `apps/web/src/app/api/poc/[id]/route.ts` (2 → 1)
  - `apps/web/src/app/api/proposals/[id]/route.ts` (2 → 1)
  - `apps/web/src/app/api/customers/[id]/route.ts` — VERIFIED already 1, leave as-is.
- **Why:** P4. In JS a second `export async function DELETE` shadows the first (last-write-wins);
  the live variant (`_request`, no auth) bypasses `assertApiAccess`. It also is a duplicate module
  export → a build/lint defect.
- **Verify:**
  ```bash
  for r in tasks opportunities poc proposals customers; do
    n=$(grep -c 'export async function DELETE' "apps/web/src/app/api/$r/[id]/route.ts")
    test "$n" -eq 1 || { echo "FAIL $r has $n DELETE exports"; exit 1; }
  done
  pnpm -w typecheck
  ```
  Add an integration test asserting an **unauthenticated** `DELETE /api/opportunities/:id` → 401/403.
- **Rollback:** restore the deleted handler blocks from `ec3f5b4`.
- **Auto-merge:** **NHR** (security-relevant).

---

### Step 2 — Land the learning-loop fix commit `bdcf333` cleanly `[SAM]` `[risk: LOW]`
- **Files (from bdcf333):** `packages/business/src/domain-memory.ts` (+`buildMemoryTags`,
  outcome-weight flip rejected `-0.3`, human-reverted `-0.3`, source=human recall bonus `+0.15`),
  `packages/business/src/domain-memory.test.ts` (+tests), `packages/business/src/project-decision.ts`.
- **Why:** `main` never touched these files since the ax merge-base (diff = 0 lines each) → the
  cherry-pick is **conflict-free**. This introduces `buildMemoryTags` (currently ABSENT on HEAD —
  VERIFIED `grep -rn buildMemoryTags packages/business/src` = 0). It is a **prerequisite** for Step 8.
- **Command:** `git cherry-pick bdcf333`.
- **IMPORTANT honesty guard:** bdcf333 alone does **not** make negative learning fire (P5) and does
  **not** fix recall symmetry (P6). Do not describe this step as "learning loop repaired." It only
  lands the tag builder + weights. Step 8 is what makes any of it reach a consumer's read path.
- **Verify:** `pnpm --filter @sangfor/business test -- domain-memory` (13 tests green).
- **Rollback:** `git revert <cherry-pick-sha>`.
- **Auto-merge:** **SAM**.

---

### Step 3 — Mail-contract port: CONFIRM NO-OP `[SAM]` `[risk: NONE]`
- **Why:** P2. HEAD's `packages/mail-intelligence/src/contract.ts` is already the minimal stub
  (`MailMessageMeta/MailGroup/TaskCandidate/EntityCandidate/MailSyncResult`, 39 lines). The rich
  `MailClassificationDecision`/`computeMailUncertainty`/`projectMailCandidateType` contract lives
  only on `origin/polish-clean` and has **zero importers even there**. `classifiedType` is
  referenced 0× in `packages/business` + `apps/web`.
- **Action:** **Do nothing to contract.ts.** Do NOT `git checkout origin/polish-clean -- contract.ts`
  (that would clobber the working stub, reshuffle the file, then require re-deleting the axes).
- **Verify (assertion only):**
  ```bash
  git grep -q classifiedType packages/business apps/web \
    && echo "classifiedType referenced — revisit Step 3" \
    || echo "Step 3 no-op confirmed"
  test "$(wc -l < packages/mail-intelligence/src/contract.ts)" -lt 60   # still the stub
  ```
- **Note in tree:** the rich mail contract is **deferred to §7** (alongside god-file decomposition, §5), where it
  becomes the canonical classification vocabulary feeding `recordDecision`. It is NOT wired this pass.
- **Auto-merge:** **SAM** (no code change).

---

### Step 4 — Pin the canonical `caseRef` prefix per entity (correlation invariant) `[NHR]` `[risk: MED]`
- **Why:** The learning-pairing seam requires an AI decision row and its human-correction row to share
  `caseRef` so a single `{caseRef}` query returns the pair (ADR-001 D3). Earlier drafts
  proposed `caseRef:'opportunity:'+id` for edits/archives while three existing spine writes already
  use **`'opp:'+id`** — a different prefix for the same entity in the same file. That silently breaks
  pairing.
- **VERIFIED existing prefixes (adopt these AS canonical; do not introduce new ones):**
  - Opportunity → **`opp:`+id** — `opportunity-center.ts:230`, `:288`, `ai-decision-deal-registration.ts:62`.
  - Engagement → **`eng:`+id** — `project-decision.ts:26`, `domain-proposal.ts:173`, `:187` (read back by `getPendingProposals`).
  - Mail candidate → **`mail_candidate:`+id** — `mail-candidates.ts` revalidation block.
- **Decision:** adopt the **existing short prefixes as canonical** (option (a) — cheaper than
  rewriting 3 load-bearing sites). Create `packages/business/src/case-ref.ts` exporting
  `caseRefFor(entity, id)` with a frozen map `{opportunity:'opp:', engagement:'eng:', mailCandidate:'mail_candidate:', customer:'cust:', partner:'partner:', task:'task:', proposal:'proposal:', poc:'poc:'}`.
  Every NEW writer (Step 6/7) MUST call `caseRefFor(...)`; the 3 existing `'opp:'` sites and the
  `'eng:'` read/write pair are already conformant and left untouched.
- **Files:** new `packages/business/src/case-ref.ts`; barrel export in `packages/business/src/index.ts`.
- **Verify (add test `case-ref.test.ts`):**
  - assert `caseRefFor('opportunity', 'x') === 'opp:x'` (matches existing sites);
  - a **correlation test**: write a `stage_transition` at `caseRefFor('opportunity',id)` and an
    `entity_edit` at the same `caseRefFor('opportunity',id)`, then query
    `domainDecisionLog.findMany({where:{caseRef: caseRefFor('opportunity',id)}})` and assert BOTH rows return.
  - a **uniformity test**: grep all spine writers for a given entity and assert identical prefix.
- **Rollback:** delete `case-ref.ts`; new writers fall back to inline literals (still `'opp:'`).
- **Auto-merge:** **NHR** (defines a cross-cutting invariant).

---

### Step 5 — Deprecate-not-drop: mark ALL redundant decision writers `[SAM]` `[risk: LOW]`
- **Why:** Converge the write path in code + intent, without touching data (§8 Data-safety).
- **Enumerate ALL `policyDecisionLog.create` writers (P3 — there are TWO helpers/sites, not one):**
  - `packages/business/src/mail-candidates.ts:1055` (`recordPolicyDecision`, 10 call sites) → doc-comment `@deprecated`.
  - `packages/business/src/mail-insight-threads.ts:252` (`thread_ingested`) → **either** doc-comment
    `@deprecated` **or** an explicit written justification that thread ingestion is a data-ingest
    event, not a governed decision, and belongs on a separate stream. **Decision:** keep it as
    ingest-audit (justify in comment), because it is not a human-in-loop decision — but it MUST be
    named in §7 so a future reader can trust the deprecation boundary is complete.
  - `packages/business/src/workflow-runner.ts:49` (`agentDecisionLog.create`) → doc-comment `@deprecated`.
  - `packages/business/src/domain-memory.ts:147` (`recordDomainDecision` → `domainDecisionLog.create`,
    the **second writer to the canonical table** bypassing the gate) → **@deprecated**, migrate its
    single call site to delegate to `recordDecision()` (pass actor/actionType) in a follow-up
    (named in §7); this pass only marks it, to keep Step 5 low-risk.
- **Files:** doc-comments only in the four files above. **No behavior change, no schema change.**
- **Verify:** `pnpm -w typecheck` (comments only) + `grep -rn "@deprecated" packages/business/src`
  lists all four.
- **Rollback:** remove comments.
- **Auto-merge:** **SAM**.

---

### Step 6 — Wire ax CRUD **edit** captures onto the spine `[NHR]` `[risk: MED]`
- **Why:** field edits are the highest-volume human-correction surface. Today they go only to
  `CustomerActivityLog` (`customer-partner.ts:142/202`) + bare `prisma.update`
  (`opportunity-center.ts:237`) and NO generator/recall reads them. Route the edit as a captured
  decision so the audit spine is complete for CRUD (recall effect is a §7 gap — be honest).
- **Files:** the `updateX` mutation functions in `opportunity-center.ts`, `task-center.ts`,
  `customer-partner.ts`, `proposal-generator.ts`, `poc-center.ts`. Add a best-effort, out-of-txn,
  non-throwing `recordDecision({ caseRef: caseRefFor(entity,id), actor:'human', actionType:'entity_edit',
  outcome:'human_edit', humanEditJson: <changed fields> })` after the successful update.
- **CRITICAL — use `caseRefFor` from Step 4**, i.e. `'opp:'+id`, so an edit pairs with the existing
  `stage_transition` at the same `caseRef`.
- **actionType coverage:** register `entity_edit` in `ACTION_TIER_REGISTRY` (T0 — a human's own edit
  is not a gated AI action) OR leave it to fail-closed T2; **decision:** T0 with an explicit registry
  entry, since it is a human action, not an autonomous one. Update `ai-decision-policy.ts:29`.
- **Verify:** `pnpm --filter @sangfor/business test`; a test that `updateOpportunity` writes a
  `domainDecisionLog` row with `caseRef='opp:'+id` and `actionType='entity_edit'`, retrievable by the
  same `{caseRef}` query as `stage_transition` (reuse the Step-4 correlation test harness).
- **Rollback:** remove the `recordDecision` calls (best-effort, so removal is safe).
- **Auto-merge:** **NHR**.

---

### Step 7 — Make deletes SOFT + captured (after auth is fixed) `[NHR]` `[risk: HIGH]`
Depends on **Step 1** (auth/dup fixed) and **Step 4** (caseRef).

- **Additive migration FIRST (invariant — see §8 Data-safety deploy-ordering):**
  add nullable `archivedAt DateTime?` to `Opportunity`, `WorkTask`, `PocProject`, `Proposal`,
  `Customer`, `Partner`. New migration dir under `packages/db/prisma/migrations/` with **only**
  `ALTER TABLE ... ADD COLUMN "archivedAt" TIMESTAMP(3)` (nullable, no default, no backfill).
  **Named precondition:** `pnpm db:migrate:deploy` MUST run against the live DB **before** the code
  that writes/reads `archivedAt` is deployed (migrate-first is always safe for an additive nullable
  column; code-first throws "unknown column" on every archive/read).
- **Code:** rewrite `archiveOpportunity` (`opportunity-center.ts:323`) and `archiveWorkTask`
  (`task-center.ts:219`) — currently `prisma.opportunity.delete` / `prisma.workTask.delete` — to
  `prisma.X.update({ where:{id}, data:{ archivedAt: new Date() } })`, plus the poc/proposal archivers.
  Each archiver also calls `recordDecision({ caseRef: caseRefFor(entity,id), actor:'human',
  actionType:'entity_archive', outcome:'human_archive' })`.
- **Read filters:** add `archivedAt: null` to the default list queries and to My Work aggregations
  (Step 7b implicit — the My Work page and each list view).
- **Server guard:** the single remaining (auth-guarded) DELETE handler requires `assertApiAccess`
  AND a typed confirmation payload (e.g. `{ confirm: 'archive', id }`).
- **Verify:**
  ```bash
  pnpm db:migrate:status         # no drift, migration present
  pnpm -w typecheck
  # integration: DELETE archives (archivedAt set), does NOT hard-delete; row still queryable.
  # integration: archived entity absent from default list; present with includeArchived.
  ```
  Row-count assert before/after on a scratch DB: `opportunities` count unchanged by an archive.
- **Rollback:** archivers revert to prior behavior is NOT desired (that reintroduces hard-delete);
  instead roll back = keep soft-delete, drop only the `recordDecision` call. The `archivedAt` column
  stays (additive, harmless).
- **Auto-merge:** **NHR**.

---

### Step 8 — ONE recall down-payment: fix write/recall tag symmetry `[NHR]` `[risk: MED]`
Depends on **Step 2** (`buildMemoryTags` exists).

- **Why:** P6. `buildMemoryTags` is used only at the WRITE site. The three recall consumers pass RAW
  tags, so `scoreDomainMemory`'s exact lowercased-string overlap can never match. Even
  approved/corrected memories are unrecallable. This is the cheapest change that makes ANY human
  memory reach the AI read path — the single learning down-payment this pass ships.
- **Files (migrate query construction to `buildMemoryTags(...)`):**
  - `packages/business/src/domain-proposal.ts:97` — replace `[input.domain, input.engagementName]`.
  - `packages/business/src/domain-agent-runtime.ts:142` — normalize `c.tags`.
  - `packages/business/src/domain-embedding.ts:95` — normalize `input.tags`.
- **Verify (write→consumer-recall round-trip — a REAL probe, not a symbol grep):**
  write an approved memory via `recordHumanDecision`, then call the ACTUAL consumer recall
  (`recallFromDb`/`recallDomainMemories` with the query the consumer builds) and assert the memory
  IS returned. Add to `domain-memory.test.ts`.
- **Scope honesty:** this fixes the **positive** (approved/corrected) recall path. It does **NOT**
  implement suppression of a positive by a same-case rejection (that needs cross-candidate logic —
  §7). Do not claim negative learning fires.
- **Rollback:** revert the 3 recall sites to raw tags.
- **Auto-merge:** **NHR** (changes AI read behavior).

---

## 3. Branch / merge sequence (3-way reconciliation)

Both feature branches are **stale**: `feat-ax-overhaul` is 101 commits behind `origin/main`
(merge-base `1032f70`); `origin/polish-clean` is 33 behind (merge-base `9fed400`). The
`mail-candidates.ts` "divergence" is really `(main, advanced +28 lines w/ recordDecision)` vs
`(both feature branches, frozen at the pre-S1 version, 0 recordDecision)`.

**Rule: REBASE / cherry-pick unique commits onto current `main`; never merge a stale branch into main.**
The integration branch `feat/decision-spine-convergence` is already off `main` and already carries a
re-authored superset of the ax UI (that is why HEAD had conflict markers, Step 0). Sequence:

1. `main` → integration branch (done).
2. Resolve conflict markers (**Step 0**).
3. Cherry-pick ax's conflict-free learning-loop commit `bdcf333` (**Step 2**).
4. Apply spine/CRUD steps (1,4,5,6,7,8) in order on the integration branch.
5. `polish-clean`: do NOT merge — its mail-contract is orphaned (Step 3 no-op) and merging it would
   DELETE the only mail→spine `recordDecision` block (28-line deletion). Its only non-contract work
   (form-accessibility label fixes across ~8 UI files, commit `bffb963`) may be cherry-picked
   **individually** if desired; it does not touch the spine.

### `mail-candidates.ts` conflict-resolution rule (load-bearing)
- The **only** correct version is `main`'s (2288 lines, contains
  `import { recordDecision }` + the S1 revalidation block at ~line 2092).
- If ANY merge/rebase presents a `mail-candidates.ts` conflict, **always keep the side that CONTAINS
  `recordDecision`** and reject the side that lacks it. Verify post-resolution:
  `grep -c 'recordDecision(' packages/business/src/mail-candidates.ts` must be **≥ 1** (currently 1).
  Never accept a resolution that yields 0.

### Expected detection results (correct the misleading `git cherry` framing)
`git cherry main origin/feat-ax-overhaul` marks ALL 8 ax commits `+` (re-authored, not patch-equal) —
so `git cherry` is the WRONG instrument. Use **per-file post-state equivalence** instead:
```bash
git diff HEAD origin/feat-ax-overhaul -- \
  'apps/web/src/app/(portal)/my-work/page.tsx' \
  'apps/web/src/components/common/entity-edit-sheet.tsx' \
  'apps/web/src/components/common/delete-entity-button.tsx'
```
A CONFLICT/DELTA here is **EXPECTED and benign** — HEAD is a re-authored SUPERSET (adds spine wiring
the ax branch lacks). **Real drift** would be a delta in `entity-edit-sheet.tsx` /
`delete-entity-button.tsx` bodies themselves (the pure UI components), which ax authored and this pass
does not change — a delta there means the reconstruction lost UI content; investigate before proceeding.

---

## 4. Decision-spine convergence details

### Canonical table + writer
`domain_decision_logs`, written **only** through `recordDecision()`
(`packages/business/src/ai-decision.ts:56`), which stamps `actor/actionType/riskTier/policyVersion`
via the fail-closed gate (`ai-decision-policy.ts:81`, unregistered actionType → T2). See ADR-001.

### `recordDecision` adapter for `MailClassificationDecision` (DEFERRED to §7, specified here)
When the rich mail contract is wired (follow-up), it feeds the spine — it does not persist itself:
```
contract axes/scores/signals  -> recordDecision.inputJson / outputJson
computeMailUncertainty().score -> recordDecision.predictedConfidence (0..1)
computeMailUncertainty().requiresHumanReview -> drives the T-tier via gateDecision
projectMailCandidateType(axes) -> the candidate write (candidateType)
derived GtmDomain (from candidate type) -> recordDecision.domain  (STOP hardcoding 'sales')
```
Note: today all 7 `domain_decision_logs` rows are `domain='sales'` because
`mail-candidates.ts:2094-2095` hardcodes `domain:'sales', actor:'sales'`. The follow-up must derive
GtmDomain from classification so the calibration `groupBy(actor,actionType)` index is meaningful.

### Deprecate-not-drop policy (data-safe)
| Table | Row count (live) | Verdict this pass |
|---|---|---|
| `domain_decision_logs` | 7 | **CANONICAL** spine (grow via recordDecision). |
| `policy_decision_logs` | 1898 | Legacy mail/ingest audit — **@deprecated writers**, rows kept read-only. |
| `agent_decision_logs` | 15 | Workflow-agent trace — **@deprecated writer** (workflow-runner). |
| `color_agent_decisions` | 0 | No writers — mark deprecated in schema comment. |
| `mail_insight_threads` ingest → `policy_decision_logs` | — | ingest-audit, justified separate stream (§7). |
No table is dropped. No column is renamed or dropped. Actual removal = a later, separately-reviewed
migration after the write path has demonstrably moved.

### `domain` semantic disambiguation (app-layer only, ZERO SQL change) — DEFERRED to §7
Rename Prisma **field names** backed by `@map` to the unchanged DB column
(`DomainMemory.domain`/`DomainDecisionLog.domain` → `gtmDomain @map("domain")`;
`Customer.domain`/`Partner.domain` → `emailDomain @map("domain")`). Verify with
`prisma migrate diff` producing an EMPTY SQL diff (proves app-layer only). Deferred because it is a
broad rename touching many call sites and is orthogonal to the write-path convergence; not required
for data safety.

---

## 5. God-file decomposition — EXPLICIT DEFERRAL

`packages/business/src/mail-candidates.ts` (2288 lines, 6 responsibility layers) is **NOT decomposed
this pass.** Rationale: it is behavior-preserving, orthogonal to the spine/data-safety goal, and
carries the load-bearing `recordDecision` block that must not be lost. Deferred plan recorded in §7.
The barrel-and-4-importers seam (web route ×2, `mail-learning.ts`, `index.ts`) and the natural
extraction seams are documented in the grounding analysis and carried into §7.

---

## 6. Verification & red-team gates (CI guard)

Add a CI job / pre-merge script asserting ALL of:

1. **No conflict markers:** `! git grep -nE '^(<<<<<<<|=======|>>>>>>>)' -- apps packages`.
2. **Typecheck green:** `pnpm -w typecheck`.
3. **Single DELETE export per route:**
   `for r in tasks opportunities poc proposals customers; do test "$(grep -c 'export async function DELETE' apps/web/src/app/api/$r/[id]/route.ts)" -eq 1; done`.
4. **mail→spine preserved:** `test "$(grep -c 'recordDecision(' packages/business/src/mail-candidates.ts)" -ge 1`.
5. **Gate-coverage (SCOPED to the spine writer only — corrected):** enumerate strings passed as
   `actionType:` to **`recordDecision(`** call sites (and, post-follow-up, the `decisionType→actionType`
   map inside `recordDomainDecision`), and assert each is in `ACTION_TIER_REGISTRY` or
   `FAIL_CLOSED_T2_ACTIONS`. **EXPLICITLY EXCLUDE** every `recordPolicyDecision(decisionType:...)`
   literal (`thread_ingested`, `candidate_created/excluded/suppressed/restored/rejected/approved`,
   `project_candidate_suppressed`) — those belong to the deprecated `PolicyDecisionLog` path and are
   NOT gated decisions. The earlier grep-everything form produced guaranteed false failures.
   ```bash
   # extract actionType args to recordDecision only, then check membership
   grep -rEoh "recordDecision\([^)]*actionType:\s*[\"'][^\"']+" packages/business/src \
     | grep -oE "[\"'][^\"']+$" | tr -d "\"'" | sort -u
   ```
6. **caseRef uniformity:** for each entity, all spine writers use the identical prefix
   (`opp:`, `eng:`, `mail_candidate:`, …); assert `caseRefFor('opportunity','X')=='opp:X'`.
7. **Correlation pairing:** a `stage_transition` and an `entity_edit` on ONE opportunity are returned
   by a single `domainDecisionLog.findMany({where:{caseRef:'opp:'+id}})`.
8. **Recall round-trip (positive):** a memory written via `recordHumanDecision` IS returned by the
   real consumer recall (`recallFromDb` with the consumer's query). — Step 8.
9. **Suppression probe (MUST FAIL on current code — encodes the honest semantics):**
   (1) recall with only a positive memory → positive returned; (2) recall with positive + a
   **same-case-key rejected** memory → positive **removed or down-ranked**. This test MUST fail today
   (proving suppression is unimplemented). It is a **§7 gate**, not a this-pass gate — include it as
   `test.todo`/skipped with a comment so no one green-lights the finding-1 defect by injecting a lone
   rejected memory and asserting its own absence.
10. **No unauthenticated delete:** integration test — unauthenticated `DELETE /api/opportunities/:id`
    → 401/403.
11. **Soft-delete:** DELETE sets `archivedAt`, row still exists; archived row absent from default list.
12. **Deprecation completeness:** all `policyDecisionLog.create` + `agentDecisionLog.create` writers
    carry `@deprecated` OR a justification comment (P3 — both `mail-candidates.ts:1055` and
    `mail-insight-threads.ts:252`).

**Do NOT accept any `grep -c <symbol> >= N` as a correctness gate** — symbol counts pass on conflicted,
non-compiling files. Every parity assertion is paired with typecheck + the no-marker gate.

---

## 7. Follow-up register (named gaps, this pass does NOT ship)

This is the canonical "deferred / named-gap" register. All in-body "deferred to a follow-up" notes
point **here** (§7); the god-file's own section is §5.

- **God-file decomposition** of `mail-candidates.ts` (2288 lines) behind the barrel-and-4-importers
  seam — behavior-preserving, orthogonal to the spine (see §5 for the deferral rationale and seams).
- **Wire the rich mail contract** (`MailClassificationDecision`/`computeMailUncertainty`/
  `projectMailCandidateType`) as classification *vocabulary* feeding `recordDecision` via the adapter
  specified in §4; it persists nothing itself. (Step 3 confirmed it is a no-op this pass.)
- **Same-case-key suppression** in `recallDomainMemories`: cross-candidate logic so a rejected memory
  down-ranks/removes a same-case positive (Gate 9 is the `test.todo` that MUST fail until this lands).
- Migrate `recordDomainDecision` (`domain-memory.ts:147`, the 2nd canonical-table writer) to delegate
  to `recordDecision`.
- `mail-insight-threads.ts:252` `thread_ingested` — decide stream ownership (ingest-audit vs spine).
- Real GtmDomain derivation at `mail-candidates.ts:2094` (stop hardcoding `'sales'`).
- `domain` field-name `@map` disambiguation (spec in §4).
- Mail-rejection **symmetric down-weighting**: `maybeProposePolicyMemoryFromRejection`
  (`mail-candidates.ts:1746-1793`) only ADDS positive `proposed` memories; a wrong classification is
  never negatively weighted. **Philosophy gap**, not just a weighting note.

### §7 Amendments (2026-07-02, Phase C red-team completion)

Items below were referenced in commit messages / ADR-001 as "named in §7" but were missing from the
register (a red-team finding), plus new gaps Phase C surfaced. They are now the register of record.

- **Step 6 remainder — edit-capture for task / customer / partner / proposal / poc**: only
  `updateOpportunity` writes `entity_edit` this pass; the other four `updateX` sites in
  `task-center.ts`, `customer-partner.ts`, `proposal-generator.ts`, `poc-center.ts` are not wired.
- **Step 7 — soft-delete (whole step unshipped)**: additive `archivedAt` migration + archiver rewrite
  + `entity_archive` capture + typed confirmation payload + delete-UX. This pass REMOVED the delete
  buttons from opportunity/task detail pages because `archiveOpportunity`/`archiveWorkTask` are still
  hard `prisma.delete` (the auth fix from Step 1 stands; the API DELETE routes match main). The
  customers/partners delete buttons remain live (their archivers are soft `status:"archived"`), but
  those archives are **not spine-captured** either — wire `entity_archive` when Step 7 lands.
- **Recall-site unification**: `domain-agent-runtime.ts:142` and `domain-embedding.ts:95` still pass
  raw tags (internally self-symmetric, so no regression — but memories written with
  `buildMemoryTags` vocabulary, e.g. via `recordHumanDecision`, are invisible to these two paths).
  Step 8 migrated only `domain-proposal.ts`.
- **Spine vocabulary deviation (recorded, was silent)**: Step 6 shipped
  `actor:"sales"`, `outcome:"corrected"` instead of the plan's `actor:'human'`/`outcome:'human_edit'`
  because `DecisionActor` (schema enum) has no `human` member and `DecisionOutcome` has no
  `human_edit`. Follow-up: additive enum migration adding proper human-actor vocabulary, then migrate
  the writer. Until then, calibration reads of `(actor, actionType)` see human edits under
  `(sales, entity_edit)`.
- **Stage+field co-edit capture gap**: `updateOpportunity` returns early after a stage change —
  a payload that edits stage AND other fields records only `stage_transition`; the co-edited fields
  are not captured as `entity_edit`.
- **Low-confidence human-rejected recall edge**: `scoreDomainMemory` = `tagScore·outcomeWeight·conf
  + 0.15 (human bonus)`; a human-source `rejected` memory with confidence < 50 and full tag overlap
  scores > 0 and is recallable despite rejection.
- **Gate-4 grep caveat**: `grep -c 'recordDecision(' mail-candidates.ts` counts 2 doc-comment hits
  inside the `@deprecated` block; real call sites = 1. Keep the gate `>= 1`; never tighten to `>= N`
  on this grep.

**Errata (history honesty):** commit `ab143a2`'s title "repair broken learning loop … + negative
learning for rejected" overstates its scope, violating the Step 2 honesty guard — it lands only the
tag builder + outcome weights; the proposal-path recall fix came later (Step 8) and cross-candidate
suppression remains unimplemented (Gate 9 `it.todo` in `domain-memory.test.ts`). The stray
`.superpowers/sdd/learning-fix-report.md` it carried has been removed. Squash-merge this branch with
an accurate title so the overclaim does not reach `main` history.

---

## 8. Data-safety summary
CORRECTION to task brief: DB uses **formal Prisma migrations** (`db:migrate:deploy` in CI),
`db push --accept-data-loss` is **banned** (`DEV_REFERENCE:213`). The real constraint is *additive
migration only*. Allowed: nullable `ADD COLUMN` + `CREATE INDEX` + `CREATE TYPE`. Forbidden:
`DROP TABLE/COLUMN`, column RENAME on live columns, non-null `ADD COLUMN` w/o default, schema change
without a paired migration file. **Deploy ordering invariant (Step 7):** apply the additive migration
to the live DB BEFORE deploying code that references the new column.
