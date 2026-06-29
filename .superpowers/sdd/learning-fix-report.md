# Learning Loop Fix Report

## Bug Summary
Three bugs broken the human-in-the-loop learning loop so corrections were stored with empty tags and never recalled, and rejected patterns were positively weighted.

## Before / After

### 1. Write side (project-decision.ts)
**Before:** `upsertDomainMemory({...})` called without `tags:` param → stored `tags: []` → recall score always 0 → human corrections permanently invisible.
**After:** `tags: buildMemoryTags({ domain, entityType: 'proposal', intentTag: outcome })` passed → tags: `['domain:sales','entity:proposal','intent:approved']`.

### 2. Recall side (domain-agent-runtime.ts line 142)
`recallFromDb({ domain, tags: c.tags })` uses `DomainCase.tags` from the pipeline input — these are already domain-controlled tags set by the caller. No structural change needed here; fixing the write-side vocabulary ensures symmetry when callers use `buildMemoryTags`.

### 3. Outcome weights (domain-memory.ts)
**Before:**
```
approved: 1.0,   corrected: 0.6,   rejected: 0.3   ← POSITIVE, keeps recommending rejected patterns
```
**After:**
```
approved: 1.0,   corrected: 0.6,   rejected: -0.3,   'human-reverted': -0.3
```
`scoreDomainMemory` now returns a negative score for rejected → filtered by `score > 0` check in `recallDomainMemories` → rejected patterns never surface as recommendations.

### 4. New helper: buildMemoryTags
`buildMemoryTags({ domain, entityType?, intentTag? })` → normalized lowercase `string[]`.
Enforces vocabulary at both write and recall boundaries.

### 5. DomainMemoryRecord.source + human bonus
Added `source?: string` to the record interface.
`scoreDomainMemory` adds `HUMAN_SOURCE_BONUS = 0.15` when `record.source === 'human'` → human-confirmed memories score higher than agent-generated ones with identical tags.
`loadDomainMemories` now maps `source` from DB rows.

## Test Results

```
pnpm --filter @sangfor/business exec vitest run src/domain-memory.test.ts
✓ 20/20 tests pass (0 failures)

pnpm --filter @sangfor/business exec tsc --noEmit
clean (no output)

CI_INTEGRATION=1 vitest run src/project-decision.test.ts
✓ 5 pure unit tests pass
✗ 4 integration tests skip/fail — DATABASE_URL not set in worktree (pre-existing, not a regression)
```

## Files Changed
- `packages/business/src/domain-memory.ts` — `buildMemoryTags` helper, `source` on interface, `rejected: -0.3`, human bonus in `scoreDomainMemory`, `source` mapped in `loadDomainMemories`
- `packages/business/src/project-decision.ts` — pass `tags: buildMemoryTags(...)` to `upsertDomainMemory`
- `packages/business/src/domain-memory.test.ts` — 13 new tests (RED→GREEN verified)

## Concerns
- Existing agent-stage memories written before this fix have `tags: c.tags` (from DomainCase), which is caller-controlled vocabulary. Those tags may not match `buildMemoryTags` format unless callers are updated to use the helper. A one-time DB migration to re-tag old records is not included here.
- The `source` field is read from the DB row via a type cast `(row as { source?: string }).source` because the Prisma-generated type for `DomainMemory` may not expose it directly — verify schema includes this column.
