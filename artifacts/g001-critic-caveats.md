# G001 terminal-critic caveats — verbatim record and disposition

The terminal critic raised ten caveats across two passes while gating the Domain-AI
embedder wiring (change set `a95cc66..HEAD`). Its findings originally lived only in
ephemeral `agent://` output; the critic itself reported them as
"unrecoverable-from-durable-state" on a later pass. This file is the durable record.

Verdicts: pass 1 at `6c07521` returned **OKAY** (blockers: none) with caveats C1–C7.
Pass 2 at `ec36b8c` returned **OKAY** (blockers: none), confirmed C1/C2 closed, kept
C3–C7 as informational, and added C8–C10.

## C1 — domain-proposal.test.ts lacks the env pin its sibling test files have

> `generateDomainProposal` now calls `resolveEmbedder()` by default
> (domain-proposal.ts:146), but domain-proposal.test.ts has no `vi.stubEnv`, unlike
> domain-agent-runtime.test.ts:12-16 and `__qa__/g001-red-team.test.ts`:22-24. On a box
> with either key set, domain-proposal.test.ts:74 would issue a real HTTP request —
> bounded by the new 10s `AbortSignal.timeout` and swallowed by `safeEmbed`, so
> non-hermetic and slow rather than failing. No assertion there depends on vector
> dimension. Harmless in this worktree (no root `.env`).

**Disposition: FIXED.** Promoted into goal G003. Module-scope `vi.stubEnv` pins
`OPENAI_API_KEY` and `EMBEDDING_BASE_URL` to `""` in domain-proposal.test.ts, matching
the sibling idiom. Red-team proved hermeticity by exporting hostile values before
vitest started and observing zero `fetch` calls, with a negative control showing the
spy is a valid witness.

## C2 — generateDomainProposal has degradation coverage but no working-embedder semantic-hit test

> domain-proposal.test.ts:93-127 injects only a throwing embedder. The brief's
> "주입 임베더 정상" case is covered for `runDomainStage`
> (`__qa__/g001-red-team.test.ts`:212-221, domain-agent-runtime.test.ts:110-119) and
> `recordHumanDecision` (project-decision.embedding.test.ts:54-65), and `recallHybrid`
> is directly unit-tested with embeddings, so the untested remainder is trivial glue.

**Disposition: FIXED.** Promoted into goal G003. Added a case whose only candidate has
`tags: []` (tag score provably exactly 0) and an embedding identical to the injected
query vector, so only the embedding term can admit it; the assertion is on the prompt
built by production code. Anti-tautology proof recorded in
`__qa__/g001-red-team-gen4-hermeticity.test.ts`.

## C3 — recallSemanticFromDb duplicates the domain: tag, inflating the tagScore denominator

> domain-embedding.ts:121 re-appends `buildMemoryTags({domain})` on top of
> `runDomainStage`'s recallTags which already contains `domain:<d>`.
> `tagScore = overlap / query.tags.length` therefore shrinks versus the old
> `recallFromDb` path. Uniform across all candidates, so relative ordering is
> unchanged; pre-existing in `recallSemanticFromDb`, not introduced by this change.

**Disposition: FIXED.** The "relative ordering is unchanged" reasoning holds only among
tag-scored candidates; once embeddings entered the blend, a deflated tag score could
lose to a similarity-only match. The query tag list is now deduplicated with a `Set`,
and a regression test asserts a two-tag exact match outranks a perfect
similarity-only match — it fails without the dedup.

## C4 — recallHybrid lacks recallDomainMemories' excludeCaseRef option

> domain-memory.ts:118 supports `excludeCaseRef`; domain-embedding.ts:84 `recallHybrid`
> does not. No production caller passed it (`recallFromDb` never forwarded options), so
> there is no regression — but the two recall functions are no longer feature-equivalent.

**Disposition: ACCEPTED, no action.** Adding an option with no caller is speculative
work. The asymmetry is recorded here so a future self-exclusion requirement starts from
a known gap rather than an assumption of parity.

## C5 — recallFromDb is now production-dead

> Only remaining caller is `packages/business/scripts/domain-pipeline-demo.ts`:51.

**Disposition: ACCEPTED, no action.** The V1 tag-only path still backs a working demo
script and its own unit tests. Deleting it would be scope creep beyond the brief.

## C6 — Scope creep beyond "packages/business/src/domain-ai/ 한정" is trivial and additive

> `packages/business/scripts/backfill-domain-embeddings.ts` (one stale comment corrected
> — the script already used `resolveEmbedder`) and a new self-cleaning
> `packages/business/scripts/smoke-embedder-wiring.ts`. Nothing touches the production
> compose stack the brief forbade.

**Disposition: ACCEPTED, no action.** Both files are additive and were required to
verify the change against a real database.

## C7 — Recall ordering will shift under the hash fallback; embeddingWeight is not plumbed through runDomainStage

> With no `OPENAI_API_KEY`/`EMBEDDING_BASE_URL` on this box the live embedder is the
> 256-dim local hash, and `hybridScore` blends `0.7*cosine + 0.3*tagScore`
> (domain-embedding.ts:77-79) with no way to tune `embeddingWeight` from
> `runDomainStage`. Rows carrying a same-dim embedding can now enter recall on
> similarity alone. This is the brief's intended tradeoff, not a defect — legacy rows
> still hold `embedding: []` and fall through to the untouched tag path.

**Disposition: FIXED (the plumbing half).** The blend ratio remains the intended
tradeoff, but "no way to tune it" was a real operability gap: a deployment running the
low-quality hash fallback had no lever. `DomainRuntimeDeps.recallOptions` now forwards
`HybridRecallOptions` into `recallSemanticFromDb`, and a test proves
`embeddingWeight: 0` excludes a similarity-only match that the default admits.

## C8 — QA-lane cleanup hygiene in g001-red-team-gen4-hermeticity.test.ts

> Three cosmetic-but-real issues, none of which can fail the suite today: (a)
> `afterEach` restores `process.env` manually and THEN calls `vi.unstubAllEnvs()`, so
> the manual restore is immediately overwritten by the hostile pre-stub snapshot — the
> intended ordering is unstub first; (b) `originalApiKey`/`originalBaseUrl` are
> undefined on this box, and Node coerces `process.env.X = undefined` to the string
> "undefined", so those lines leave truthy junk values behind rather than unset vars;
> (c) `vi.stubGlobal('fetch', ...)` is never undone — `vi.restoreAllMocks()` does not
> revert `stubGlobal`.

**Disposition: FIXED.** `afterEach` now unstubs envs and globals before restoring, and
deletes the variables when they were originally unset instead of assigning `undefined`.

## C9 — Review-artifact staleness

> `artifacts/g001-architect-review.json` and `artifacts/g001-embedder-redteam-report.json`
> both pin the reviewed range at `6c07521..7eeb519` with "HEAD verified 7eeb519", but
> they are committed at `ec36b8c`, which also adds the gen4 QA test file. The architect
> lane therefore has no coverage of `__qa__/g001-red-team-gen4-hermeticity.test.ts` —
> that file is QA self-attested only. I read it in full and it contains no
> product-affecting defect (see C8), so this is a provenance note rather than a gap.

**Disposition: ACCEPTED, recorded.** Inherent to a lane writing its own evidence file
inside the generation it reviews. The critic read the file in full and the only defects
it found (C8) are now fixed.

## C10 — Wall-clock timing assertion is mildly flake-prone

> `__qa__/g001-red-team-gen4-hermeticity.test.ts`:87
> (`expect(embedElapsedMs).toBeLessThan(50)`) is a wall-clock threshold on a pure
> computation path. Sound today, mildly flake-prone on a heavily loaded runner.

**Disposition: FIXED.** Replaced with a deterministic assertion that the returned
vector has the local hash embedder's 256 dimensions; the `fetch` spy already proves no
network was touched.
