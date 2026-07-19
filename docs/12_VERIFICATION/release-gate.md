# Release gate (U007)

## Purpose

Three-workspace (`root`, `engineer`, `workflow`) release verification with:

- Tracked 15-step manifest (`scripts/release-gate.manifest.json`)
- Strict test/command result parser (rejects 0-tests, skip/fixme/todo/only/flaky/retry, false-green scripts)
- Detached git worktree mirror (no product commands on original worktree)
- Digest-pinned scratch PostgreSQL (`postgres:16-alpine` lock)
- Dual receipts: `runner_contract` PASS + pre-U030 `product_release` RED_EXPECTED

## Outer command (authoritative)

```bash
node scripts/run-detached-release-mirror.mjs \
  --mode u007-release \
  --candidate-sha "$CANDIDATE_SHA" \
  --run-id "$TASK_RUN_ID" \
  --owner-unit U007 \
  --attempt-dir "$ATTEMPT_DIR" \
  --resource-lease-file "$RESOURCE_LEASE_FILE"
```

Pre-U030 successful outer exit is **78** (not 0). Dispatcher must also run:

```bash
bash scripts/run-workspace-runtime.sh root -- node scripts/check-release-state-receipts.mjs \
  --phase pre_u030 \
  --runner "$ATTEMPT_DIR/runner-contract-receipt.json" \
  --product "$ATTEMPT_DIR/product-release-receipt.json"
```

## Expected pre-U030 product status

- `runner_contract_status=PASS`
- `product_release_status=RED_EXPECTED`
- Exactly one blocker: `@sangfor/ui` `echo No tests` (`FALSE_GREEN_TEST_SCRIPT`)
- U030 removes the false-green package and re-runs `u030-post-release` for product PASS

## Delegators

`scripts/run-all-checks.sh` and `scripts/validate.sh` only `exec` the outer runner via `run-workspace-runtime.sh root`. Missing outer args → exit 64.

## Local unit lane

```bash
bash scripts/run-workspace-runtime.sh root -- node --test \
  scripts/verify-release.test.mjs \
  scripts/check-no-false-green-tests.test.mjs \
  scripts/release-state-receipt.test.mjs \
  scripts/lib/strict-command-result.test.mjs \
  scripts/lib/resource-lease.test.mjs \
  scripts/lib/sanitized-process-env.test.mjs \
  scripts/lib/detached-release-mirror.test.mjs \
  scripts/run-detached-release-mirror.test.mjs \
  scripts/lib/isolated-postgres.test.mjs \
  scripts/run-with-isolated-postgres.test.mjs \
  scripts/run-playwright-acceptance.test.mjs
```
