# Final Release Readiness Runbook

## State model

- `LOCAL_PASS_EXTERNAL_PENDING`: all 98 autonomous acceptance rows passed at one committed candidate SHA; `AC-DOD-09` remains unexecuted and pending explicit external approval.
- `MANUAL_EXTERNAL_PASS`: a later approved staging connector workflow completed `AC-DOD-09` and supplied its candidate-bound receipt.
- A local run must never claim production or external release readiness while `AC-DOD-09` is pending.

## Preconditions

1. Use Node 20 at the repository root, Node 20 for `services/sangfor-engineer-mcp`, and Node 22 for `services/sangfor-mcp-workflow`.
2. Require a clean source worktree whose `HEAD` equals the lowercase 40-hex SCM handoff SHA.
3. Require a fresh absolute U076 attempt directory, one unexpired U076 resource lease, and a dispatcher-created absolute 23-alias lease-map JSON file.
4. Do not provide `DATABASE_URL`, proxy variables, connector credentials, or `ALIAS_S9A_RECEIPT_FILE` from the caller.

## Focused implementation gate

```bash
bash scripts/run-workspace-runtime.sh root -- node --test \
  scripts/run-final-acceptance.test.mjs \
  scripts/verify-acceptance.test.mjs \
  scripts/verify-staging-equivalent.test.mjs
```

The command must return zero with no skipped tests. Direct `pnpm verify:final-acceptance` is diagnostic only.

## Authoritative entrypoint

```bash
FINAL_CANDIDATE_SHA=<candidate-sha> \
FINAL_ALIAS_LEASE_MAP=<absolute-lease-map.json> \
SCM_HANDOFF_FILE=<absolute-scm-handoff.json> \
TASK_RUN_ID=<U076-run-id> \
TASK_OWNER_UNIT=U076 \
PORT=<leased-web-port> \
API_PORT=<leased-api-port> \
ACCEPTANCE_EVIDENCE_DIR=<absolute-browser-evidence-dir> \
RESOURCE_LEASE_FILE=<absolute-U076-lease.json> \
node scripts/run-detached-release-mirror.mjs \
  --mode u076-final-aliases \
  --candidate-sha <candidate-sha> \
  --run-id <U076-run-id> \
  --owner-unit U076 \
  --attempt-dir <absolute-fresh-attempt-dir> \
  --resource-lease-file <absolute-U076-lease.json>
```

Only this U007 detached-mirror entrypoint may produce authoritative evidence. It must finish with 23 fresh alias receipts, an exact 98-row autonomous partition, one `manual-external-staging.json` pending receipt, complete database/process/port/mirror cleanup, and `final-acceptance.json` reporting `LOCAL_PASS_EXTERNAL_PENDING`.

## Retry and cleanup

1. Never reuse or edit a failed attempt directory.
2. Confirm the failed attempt removed its detached worktree, labelled PostgreSQL resources, listeners, and child processes.
3. Return a defect to its owning unit. After repair and fresh independent review, SCM creates a new commit and handoff SHA.
4. Allocate new run IDs, ports, leases, evidence directories, and a new attempt directory, then rerun from the authoritative entrypoint.

## External gate

`AC-DOD-09` requires explicit approval, staging credentials, and the protocol in `docs/12_VERIFICATION/connector-external-smoke-protocol.md`. U076 only emits the pending receipt; it does not deploy, send, share, or mutate production systems.
