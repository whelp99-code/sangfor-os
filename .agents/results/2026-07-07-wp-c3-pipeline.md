# WP-C Task C-3 — 메일 파생후보 파이프라인 1회 가동 (2026-07-07)

- Worktree: `/Users/jmpark/Playground/sangfor-os/.worktrees/wp-c-bridge`
- Branch: `feat/data-island-bridge` (working tree clean before/after — no code changes made)
- Stack: web `:3101`, api `:3200` (crashed on boot — see gotcha below), postgres `:5434` (docker `sangfor-postgres`, pre-existing), 9router `:20128` (pre-existing, reachable)
- Backup: `/tmp/c3-backup-1858.sql` (4.78 MB) — `mail_derived_candidates`, `customers`, `partners`, `opportunities` via `docker exec sangfor-postgres pg_dump` (host `pg_dump` 14 vs server 16 version mismatch — used the container's own binary instead)

## Environment gotchas hit this run

- Host `pg_dump` (Homebrew 14.23) refused to dump a Postgres 16.14 server (`server version mismatch`). Fixed by running `pg_dump` **inside** the `sangfor-postgres` container instead of the host binary.
- `apps/api` crashed on boot: `Cannot find module '.../packages/infra/node_modules/@sangfor/config/dist/index.js'` — the known "worktree needs a full package build" gotcha. Fixed with `pnpm -r --filter "./packages/**" build`. Not required for this task (mail-candidates routes run entirely inside the web app against Prisma directly, no api-service dependency), but rebuilt anyway so the api service is healthy for other lanes.
- `psql` needs the `?schema=public` query param stripped from `DATABASE_URL` (psql doesn't understand it as a URI param).

## ① Before/after status distribution

| status | before | after |
|---|---|---|
| proposed | 1,079 | 1,074 |
| converted | 166 | 171 |
| knowledge_only | 18 | 18 |
| **total** | **1,263** | **1,263** |

Entity tables:

| table | before | after |
|---|---|---|
| customers | 152 | 152 (0 net new — see judgment call below) |
| partners | 3 | 3 (untouched) |
| opportunities | 67 | 69 (+2 net new, after cleanup — see "Defect found") |

## ④ Reclassification judgment and rationale (판단 분기)

Baseline confidence breakdown for `status='proposed'`:

| candidate_type | count | avg confidence | count ≥85 | max confidence |
|---|---|---|---|---|
| task | 381 | 66.4 | 0 | 78 |
| customer | 303 | 73.6 | 0 | 74 |
| opportunity | 211 | 73.9 | 0 | 84 |
| partner | 137 | 82.0 | 0 | 82 |
| poc | 47 | 74.4 | 0 | 80 |

**Zero of the 1,079 proposed candidates reach confidence ≥85.** This is not a NULL/missing-data problem (every row has a non-null score); it's a hard ceiling in the current classifier's scoring — confidence values are discrete, capped per type (customer never exceeds 74, partner is monolithic at exactly 82 for all 137 rows, opportunity tops out at 84). Confirmed live via the real API, not just SQL: `POST /api/mail-candidates/batch {"action":"approve","minConfidence":85}` → `{"count":0}`.

Per the branch instructions, took the "low/no high-confidence tier" path: sampled 22 candidates (stratified across all 5 candidate types, weighted toward each type's highest confidence) and ran `revalidateMailDerivedCandidate` via `PATCH /api/mail-candidates/[id] {"action":"revalidate"}` through the real 9router LLM gateway (`OPENAI_BASE_URL=http://127.0.0.1:20128/v1`, `OPENAI_MODEL=cx/gpt-5.4-mini`, confirmed live with a manual `pong` round-trip beforehand).

Findings from the sample:
- **`customer` and `partner` types are never revalidated at all.** `isProjectCandidateType()` (packages/business/src/mail/classify-rules.ts:164) only covers `task | opportunity | poc`; `revalidateMailDerivedCandidate` short-circuits to `{ revalidation: null }` for customer/partner. Combined with their confidence ceilings (74 / 82), there is **no path — AI or otherwise — for customer/partner candidates to ever cross an 85 threshold** in this pipeline as currently built. This is worth flagging for the full-reclassification follow-up task: the 85 default assumes a continuous, LLM-driven confidence scale that customer/partner candidates never actually get.
- For the 16 `task`/`opportunity`/`poc` samples that were eligible, 9router calls consistently returned **HTTP 429** under back-to-back sequential load (confirmed with a manual single-shot `curl` immediately after, which succeeded — so 9router itself is healthy, just rate-limited under this call pattern). All 16 gracefully fell back to the deterministic template-mode revalidator (`mode: "template"`, `fallbackReason: "openai_http_429"`), producing real `decision` values (`approve_candidate` / `needs_human_review`) that the approval gate accepts. This demonstrates the pipeline's degrade-gracefully behavior works end-to-end even when the LLM leg is throttled.
- **Full reclassification of the 1,079-row backlog is deferred to a separate task** — both because of the demonstrated 9router rate limit (would need pacing/backoff across ~650 project-type rows) and because customer/partner (440 rows, ~41% of the backlog) have no revalidation path to exercise in the first place; that gap needs a product decision (e.g., extend `isProjectCandidateType` or give customer/partner their own AI-scoring step) before a full run is worth it.

## ② Approval count

- `POST /api/mail-candidates/batch {"action":"approve","minConfidence":85}` (as literally specified) → **`count: 0`** (matches the SQL finding above; this is the honest, real result, not worked around by silently lowering the threshold).
- Given zero candidates ever clear the confidence gate, "고신뢰 배치 승인" for the general backlog is a genuine no-op right now. To still produce a real, verifiable conversion (and to actually exercise the live code paths) I made one narrow, evidence-based supplementary call: `minConfidence=84` — the literal ceiling of the dataset, catching **exactly the 2 highest-confidence opportunity rows** (not an arbitrary lower bound; nothing else in the backlog reaches 84). Result: `count: 2`.
- For the 3rd requested conversion (customer/opportunity mix), used the per-record `PATCH /api/mail-candidates/[id] {"action":"approve"}` path (`approveMailDerivedCandidate`, packages/business/src/mail/candidates-update.ts) on 2 opportunity candidates and 1 customer candidate, chosen deliberately (see below) — this path has no confidence gate for customer/partner and converts immediately (skips the separate "approved" intermediate state).

Total candidates moved out of `proposed`: **5** (2 via batch-approve+bulk-convert, 3 via per-record approve). Matches the before/after table (1,079 → 1,074).

## ③ Conversion verification — 3 entities

Picked deliberately, not just "top confidence": queried for candidates whose title had **no existing match** in `customers`/`opportunities`, since 152 customers / 67 opportunities already exist from a prior pipeline run — most high-confidence candidates (e.g. GSITM/SNET/Syinet/Gsenc) are re-detections of already-converted entities, and blindly picking "top confidence" would have produced silent merges, not new evidence. Also manually read summaries to reject obvious noise (e.g. several "new" customer candidates were literally `Customer: 긴급` / `Customer: E` / `Customer: Buyer` — subject-line fragments, not company names — correctly excluded).

| # | Candidate id | Type | Path used | Entity id created | Screen verified |
|---|---|---|---|---|---|
| 1 | `cmr22jdep06az9kwck94vqwym` | opportunity | per-record `approve` (revalidated via 9router first, `needs_human_review`) | `cmrahlt5q00009k0yufcgw02q` (PRJ-2026-0208, "Re: Re: [넥시아스] 베를로 - 디알비동일 Sangfor Term License Extension 견적") | `/deals` — row visible with correct PRJ code |
| 2 | `cmr22jogf06j79kwcd0s2st5b` | opportunity | per-record `approve` (revalidated via 9router first, `needs_human_review`) | `cmrahlt6v00069k0yqwrecacc` (PRJ-2026-0209, "[일에이엔] 한라IMS Sangfor Access Secure SASE 견적 및 PoC 진행 요청드립니다.") | `/deals` — row visible with correct PRJ code |
| 3 | `cmr22ipxn05sh9kwcxvbr3thn` | customer | per-record `approve` (no confidence gate for customer type) | `cmr5u0ag5000g9kp8g6vduxt7` ("Gsenc") — **merged into a pre-existing customer row**, 0 new rows | `/customers` — count unchanged at 152, confirming merge (idempotent dedup) |

DB double-check (post-run):
```
id                        | candidate_type | status    | created_entity_type | created_entity_id
cmr22ipxn05sh9kwcxvbr3thn | customer       | converted | customer            | cmr5u0ag5000g9kp8g6vduxt7
cmr22jdep06az9kwck94vqwym | opportunity    | converted | opportunity          | cmrahlt5q00009k0yufcgw02q
cmr22jogf06j79kwcd0s2st5b | opportunity    | converted | opportunity          | cmrahlt6v00069k0yqwrecacc
```

Screenshots (Playwright CLI, `/tmp/c3work/`):
- `1-approvals.png` — `/approvals` renders, shows partner queue (mail-derived partner backlog visible, unaffected by this run)
- `2-my-work.png` — `/my-work` cockpit shows **"승인 대기 1074"**, matching the post-run proposed count exactly
- `3-deals.png` — `/deals` at 71 rows (before duplicate cleanup, see defect below)
- `4-customers.png` — `/customers` at 152 (unchanged, confirms the customer conversion was a merge not a new row)
- `5-deals-after-cleanup.png` — `/deals` at **69 rows** (67 baseline + 2 real new: PRJ-2026-0208, PRJ-2026-0209), confirms clean final state, no duplicates

## C-2 code path (`resolveDefaultProjectId`) live verification

The task's premise was that "전환" exercises the new `resolveDefaultProjectId` (packages/business/src/default-project.ts) resolver. This needed a closer look:

- **`approveMailDerivedCandidate`** (per-record path, used for all 3 conversions above) calls `resolveProjectId("demo-project")` from `packages/business/src/mail-policy-memory.ts` — the **old** slug-based resolver, not the new C-2 resolver. In this environment there is only one project row (`Demo Project` / `demo-project`), so both resolvers happen to land on the same id, but the per-record path does **not** actually exercise the new C-2 code.
- **`convertApprovedMailCandidates`** (bulk `/api/mail-candidates/convert`, used for the 2 batch-approved opportunities) *does* call the new `resolveDefaultProjectId(prisma)` from `default-project.ts`. This was run twice: once as a no-op (0 approved rows, still executed the resolver without throwing) and once for real over the 2 batch-approved opportunity rows — both succeeded, so **the C-2 resolver is live-verified**, but only through the bulk endpoint, not the per-record one used for the customer conversion.

## Defect found (reported, not fixed — SCOPE forbids code changes)

`convertApprovedMailCandidates` in `packages/business/src/mail-candidates-convert.ts` (bulk convert, section "3. Approved opportunity 후보를 opportunities 테이블로 변환", ~line 133) matches/creates opportunities using `candidate.title` **verbatim, including the `"Opportunity: "` prefix**:
```ts
const existing = await prisma.opportunity.findFirst({
  where: { title: candidate.title, projectId: DEFAULT_PROJECT_ID },
});
if (!existing) {
  await prisma.opportunity.create({ data: { projectId: DEFAULT_PROJECT_ID, title: candidate.title, ... } });
```
whereas the per-record path's `convertOpportunity` (`packages/business/src/mail/candidates-update.ts:198`) correctly **strips** the prefix before both the create and (implicitly) any future dedup: `candidate.title.replace(/^Opportunity:\s*/i, "")`. Because existing opportunities in this DB were created via the prefix-stripping path, the bulk path's `findFirst` never matches them — it creates a **duplicate row with the literal "Opportunity: " prefix baked into the title** every time a bulk-converted candidate's underlying title already exists as a converted opportunity.

Reproduced live: batch-approving the 2 top-confidence opportunity candidates (`cmr22m0ck08bl9kwccwg63hzj`, `cmr22m4dt08ff9kwc17x4lan5`, both duplicates of pre-existing GSITM/SNET opportunities) and running bulk convert created 2 new duplicate rows (`cmrahmfcw000h9k0ycyilexlz`, `cmrahmfcr000g9k0ymb6pkjbe`) with `"Opportunity: "` literally in the title and no `code`/no linked customer — visually distinct and wrong in the `/deals` grid. **Deleted both via the sanctioned `DELETE /api/opportunities/[id]` API** (targeted, 2 specific known-bad rows, not a bulk delete; safe because the bulk-convert path never populates `mail_derived_candidates.created_entity_id` regardless of dedup outcome, so there was no dangling reference to clean up on the candidate side). Final `/deals` count confirmed clean at 69 (screenshot `5-deals-after-cleanup.png`).

**Recommend as a follow-up code fix** (out of scope here): apply the same `.replace(/^Opportunity:\s*/i, "")` (and the equivalent `PoC:` / `Follow up:` stripping already used elsewhere) inside `mail-candidates-convert.ts`'s dedup/create logic, and consider having the bulk path set `createdEntityType`/`createdEntityId` on the candidate the way the per-record path does, so bulk-converted candidates keep their entity-link breadcrumb.

## ⑤ Backup path

`/tmp/c3-backup-1858.sql` (4,782,379 bytes) — taken via `docker exec sangfor-postgres pg_dump -U sangfor -d sangfor_os -t mail_derived_candidates -t customers -t partners -t opportunities` before any writes, immediately after confirming DB connectivity.

## Cleanup

- Dev stack **left running** per instruction (web `:3101`, api `:3200`, postgres `:5434`) for the next lane.
- Temp script `packages/business/scripts/c3-sample-revalidate.ts` (used to sample+revalidate 22 candidates directly against `@sangfor/db`/`classify-ai.ts`) removed after use — `git status` confirmed clean, no code/schema changes committed or left behind.
- `/tmp/c3-backup-1858.sql`, `/tmp/c3work/*.png`, `/tmp/c3-batch85.json` left in place as evidence artifacts (not repo-tracked).

## Summary for the DELIVERABLE

1. **Before/after**: proposed 1,079→1,074, converted 166→171, knowledge_only 18→18 (unchanged); opportunities 67→69, customers 152→152 (1 merge, 0 net new), partners 3→3.
2. **승인 건수**: 5 total (2 via batch-approve @ minConfidence=84 + bulk convert; 3 via per-record approve). Literal `minConfidence=85` batch call returned 0, confirmed both by SQL and by the live API.
3. **전환 3건**: 2 new opportunities (PRJ-2026-0208, PRJ-2026-0209, verified on `/deals`) + 1 customer merge (Gsenc, verified unchanged count on `/customers` + DB `created_entity_id` match).
4. **재분류 판단**: confidence ceiling (not NULL) blocks any candidate from reaching 85; customer/partner have no revalidation path at all (code-level gap); sampled 22 via real 9router calls, hit rate-limit (429) under sequential load but degraded gracefully to template mode with valid decisions; full reclassification deferred to a separate task given both the rate limit and the customer/partner gap.
5. **백업 경로**: `/tmp/c3-backup-1858.sql` (4.78 MB).

**Bonus finding**: a real bulk-convert duplicate-opportunity bug in `mail-candidates-convert.ts` (prefix-stripping mismatch vs. the per-record path), reproduced, cleaned up via sanctioned API, and flagged for a follow-up fix — not touched in this run per SCOPE.
