# Unsafe Action Matrix

## Purpose

Verify that unsafe actions remain approval-gated across dev/demo workflows.

## Unsafe actions

| Action | Default state | Approval required | Notes |
| --- | --- | --- | --- |
| send | blocked | yes | Customer-facing send remains disabled until approval. |
| export | blocked | yes | Proposal/quote export remains disabled until approval. |
| share | blocked | yes | External sharing remains disabled until approval. |
| delete | blocked | yes | Destructive action. |
| deploy | blocked | yes | Outward-facing operation. |
| real-upstream-write | blocked | yes | Real upstream write. |
| production-db-mutation | blocked | yes | Production data mutation. |
| release-tag | blocked | yes | Release operation. |

## Proposal action regression

Draft proposals must return `proposal_action_requires_approval` for `send`, `export`, and `share`.
Approved proposals may expose allowed state, but this runbook does not execute any real external action.

## Verification

```bash
pnpm --dir packages/shared exec vitest run src/modes.test.ts
pnpm --dir packages/business exec vitest run src/revenue-core.test.ts
```
