# W3-W4 Revenue Core Runbook

## Purpose

Verify the W3-W4 revenue core activation baseline for `sangfor-os`: quote margin calculation, commercial approval gates, revenue approval queue filters, and proposal action blocking.

## Safety boundary

This runbook does not send, export, share, or publish customer-facing artifacts. Proposal `send`, `export`, and `share` actions remain blocked unless the proposal status is `approved`.

## Focused verification

```bash
pnpm --dir packages/business exec vitest run src/quote-engine.test.ts src/revenue-core.test.ts src/commercial-approval.test.ts
pnpm --filter @sangfor/business typecheck
```

Expected:

```text
Test Files ... passed
```

## Full local gates

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Manual checks

1. Confirm low-margin quotes return `requiresCommercialApproval: true`.
2. Confirm high-discount quotes include `high_discount` in `approvalDecision.reasons`.
3. Confirm draft proposals return `proposal_action_requires_approval` for `send`, `export`, and `share`.
4. Confirm `filterRevenueApprovalQueue` can isolate CFO `ready_for_human_approval` items.

## Rollback

The W3-W4 baseline is additive. If a downstream workflow has issues, callers can continue using existing quote/proposal functions while ignoring the new `approvalDecision` and revenue queue helper until the follow-up PR is ready.
