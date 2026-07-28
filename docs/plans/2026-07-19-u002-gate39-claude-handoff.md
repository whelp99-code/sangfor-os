# U002 Gate39 Claude Handoff

- Prepared: 2026-07-19 (Asia/Seoul)
- Worktree: `/Users/jmpark/Playground/sangfor-os-w0-w6`
- Branch: `codex/system-refactor-w0-w6`
- Baseline commit before this handoff document: `425440799fdfb5bf35842f41603de94b9b1d2154` (`Plan: U001`)
- Scope completed by Codex: independent verification of Grok's failed U002 Attempt 6 and definition/dispatch of the safe Gate39 continuation.

## 1. Ownership transition

Codex must stop after this document-only commit. Claude owns continuation and verification from this point.

An active Grok worker already owns implementation and release work:

| Field | Value |
| --- | --- |
| Orca task | `task_af2e69693b4f` |
| Dispatch | `ctx_f0bad73e8143` |
| Grok terminal | `term_4f81f156-737d-4660-aa8a-ad42c3939d26` |
| Worktree | `/Users/jmpark/Playground/sangfor-os-w0-w6` |
| Assigned scope | Gate39 remediation, one fresh Attempt 7 if authorized, U002 closure, U003, U004, atomic commits, push, and merge |

Do not edit the product worktree while this Grok dispatch is active. Check completion through:

```bash
orca orchestration task-list --json
```

The prior worker completion message was addressed to Codex's coordinator terminal, so Claude should treat the Orca task state, task result, Git state, and stored evidence as the authoritative handoff rather than waiting for an inherited inbox message.

## 2. Current verified state

### U001

- Committed: `425440799fdfb5bf35842f41603de94b9b1d2154 docs: freeze canonical requirement and acceptance registries`.

### U002 Attempt 5 and Attempt 6

- Attempt 5 (`u002-attempt5-4e9949aa-21ff-4b19-8485-49e682e5738f`) failed before service spawn and is immutable. Independent verification recomputed its 823 file hashes and metadata as unchanged.
- Attempt 6 (`u002-attempt6-7b112389-cf24-46c9-8a8a-4ad55826e223`) was authorized exactly once, then failed closed with exit `68` and `FINAL_PRIOR_RUN_EVIDENCE_INVALID` before `real-surface/` creation.
- The failure is terminal: never retry Attempt 6. Its canonical attempt root contains only `controller-run-context.json` mode `0600`; no receipt, finalizer, SCM closure, or U003 dispatch exists.
- Root cause: historical Attempt 2 `dispatcher/snapshot.json` is valid JSON but is not the later pretty-JSON canonical serialization. It is 5,507 bytes with SHA-256 `792679bd0b58ed762f36654bfcfaa92cda1731ba0fab1d36c814b1325608e791`.

Primary evidence:

- `.omo/evidence/gate38-u002-tmpdir-identity-remediation-20260718/attempt6-controller/LIFECYCLE-FAILURE.md`
- `.omo/start-work/ledger.jsonl` line with `u002-attempt6-lifecycle-failure`
- `.omo/evidence/sangfor-system-refactor-2026-07-15/U002/attempt-2/dispatcher/snapshot.json`

### Gate38 state

The latest tmpdir identity remediation remains sound on its own scope:

- Runner SHA-256: `0e57a78da686f8e96b48ef0be77bd1fefd09a0034b6a50df4953f23f3783000c`
- Test SHA-256: `2d3814b653fffdf7c002f35edd0a9c3bb7bdaf16435094fb3601dd5d5b195209`
- Independent isolated Node 20 scenarios passed: replaced tmpdir pathname and post-precheck descriptor race, 2/2.

This does not authorize any lifecycle or release by itself.

### Git and release state

- U002, U003, and U004 have no atomic commits.
- No push or merge occurred. `origin/main` remains `081a1c0c708104f7d0dd50667a261ea84e9ce85c`.
- The integration worktree has substantial pre-existing U002 source/test changes. Preserve them; this handoff commit contains only this document.
- The user's primary checkout `/Users/jmpark/Playground/sangfor-os` is independently dirty/untracked and must never be reset, cleaned, or used for merge writes.

## 3. Gate39 required implementation contract

The correct compatibility route is deliberately narrow. Do not rewrite, chmod, delete, normalize, or otherwise change attempts 1 through 6 or their metadata.

`parseStableJson` must remain canonical for current and future generated artifacts, controller records, finalization artifacts, and all normal historical artifacts. Only `derivePriorRunIds` may accept one legacy evidence item:

| Requirement | Exact value |
| --- | --- |
| Path | `U002/attempt-2/dispatcher/snapshot.json` |
| SHA-256 | `792679bd0b58ed762f36654bfcfaa92cda1731ba0fab1d36c814b1325608e791` |
| Bytes | `5507` |
| Text | strict UTF-8, no CR, exactly one final LF |
| Identity | `schemaVersion=1`, `unit="U002"`, `attempt=2`, `runId="8D56404A-D4CC-4A33-AEC5-8EF9B8F163F8"` |

Retain the existing stable descriptor/no-follow/regular/single-link protections and all semantic run-ID validation. Reject with `FINAL_PRIOR_RUN_EVIDENCE_INVALID` for any mutation, wrong path/attempt, generic parseable noncanonical JSON, bad semantic identity, symlink/hardlink, duplicate/conflicting ID, or unresolved ID. Do not introduce a generic legacy parser.

### Required RED→GREEN coverage

1. Copy the immutable real Attempt 2 bytes into an isolated temporary fixture. Before the code change it must fail with `FINAL_PRIOR_RUN_EVIDENCE_INVALID`.
2. After the narrow rule, the exact copy must yield run ID `8D56404A-D4CC-4A33-AEC5-8EF9B8F163F8`.
3. Prove the original source evidence bytes and metadata are unchanged.
4. Add/retain adversarial rejects for a one-byte mutation, wrong path/attempt, arbitrary noncanonical JSON, semantic mismatch, link attacks, duplicate IDs, and unresolved IDs.

Relevant source seams:

- `scripts/check-u002-containment-surface.mjs`: `parseStableJson`, `derivePriorRunIds`, `validateControllerRunContext`
- `scripts/check-u002-containment-surface.test.mjs`: Gate38 fixture and prior-run derivation tests near `writePriorSnapshot`

## 4. Gate39 and Attempt 7 order

Before creating any Attempt 7 controller, Grok must:

1. Append a Gate39 control correction to the U002 plan/dispatch and ledger; recompute authority body, full dispatch, and normative section hashes.
2. Capture the isolated RED→GREEN proof and all adversarial failures.
3. Pass focused compatibility tests, the full Node 20 U002 suite, ownership scanner, dispatch validator, canonical plan validator, and source aggregate validation.
4. Prove attempts 1 through 6 and U003 are byte/metadata unchanged, with Attempt 7 absent and no lifecycle/finalizer/SCM action yet.
5. Obtain fresh independent code review, control-gate review, and pre-lifecycle QA against the final hash-pinned bytes.
6. Append the single Attempt 7 authorization only after all above are green.

The Attempt 7 controller must be a new mode-`0600` file created immediately before a single runner invocation. It must use a fresh run ID, timestamp, five fresh loopback ports, and exactly these sorted prior IDs:

```text
09821E4E-ECC4-410E-A8FA-DB8B290C0000
7572F805-1964-4671-ADD7-79774C8C2893
8D56404A-D4CC-4A33-AEC5-8EF9B8F163F8
9D7F41A4-C191-49DF-BF9C-BBE7B0B6273B
u002-attempt5-4e9949aa-21ff-4b19-8485-49e682e5738f
u002-attempt6-7b112389-cf24-46c9-8a8a-4ad55826e223
```

Never retry Attempt 7. If it fails, preserve the evidence and start a new gated decision instead of rerunning it.

## 5. Downstream work

U003 remains blocked until U002 has a valid PASS receipt and atomic SCM closure. U004 remains blocked until U003 passes. If Grok completes U002 successfully, Claude must independently verify its receipt/commit before accepting U003/U004, then independently verify the eventual commits, push, and merge against remote `main`.

Use the existing dispatch cards as the source of truth:

- `.omo/start-work/dispatches/U002.md`
- `.omo/start-work/dispatches/U003.md`
- `.omo/start-work/dispatches/U004.md`

## 6. Claude first actions

1. Read `AGENTS.md`, this document, `.omo/start-work/ledger.jsonl`, and the latest task result for `task_af2e69693b4f`.
2. Do not interfere with Grok while its task is `dispatched`.
3. When it completes, independently check immutable history, Gate39 test/evidence integrity, receipts, commits, and remote refs before any completion claim.
4. If Grok reports a terminal failure, do not rerun that attempt. Preserve it, identify the next new-attempt gate, and dispatch the smallest history-preserving remediation.
5. Preserve unrelated dirty files throughout. No production deployment, external mutation, force push, reset, or destructive cleanup is authorized.
