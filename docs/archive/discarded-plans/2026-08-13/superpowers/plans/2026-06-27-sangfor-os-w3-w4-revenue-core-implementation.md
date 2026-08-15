# Sangfor OS W3-W4 Revenue Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the W3-W4 revenue core by hardening opportunity qualification, quote/commercial approval gates, proposal approval/export blocking, and approval queue filters without external side effects.

**Architecture:** Keep implementation additive and local/dev safe. Extend pure business modules in `packages/business` first, then expose read-only summaries and gate states to UI/API where useful. Do not send/export/share externally; implement blocked decisions and evidence-ready states only.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Prisma 6, Next.js 16 App Router.

## Global Constraints

- Work in `/Users/jmpark/Playground/sangfor-os` on branch `continue-mail-candidate-connection-ui`.
- Follow TDD: write failing tests, verify RED, implement minimal code, verify GREEN.
- Do not send real mail, deploy, mutate production DBs, force push, or create release tags.
- External send/export/share actions must remain blocked unless explicitly approved.
- AI output is draft until reviewed and approved.
- Keep DB changes additive.

---

## File Structure

- Modify: `packages/business/src/quote-engine.ts`
  - Add validation for finite positive quantity/prices and discount percentages.
  - Add `approvalDecision` to quote results using commercial gate semantics.

- Modify: `packages/business/src/quote-engine.test.ts`
  - Add regression tests for margin, discount approval, invalid input, and safe review-only state.

- Create: `packages/business/src/revenue-core.ts`
  - Produce W3-W4 revenue activation summaries, approval queue filters, proposal action guards.

- Create: `packages/business/src/revenue-core.test.ts`
  - Unit tests for approval queue filtering and proposal export/send blocking.

- Modify: `packages/business/src/proposal-generator.ts`
  - Add pure `evaluateProposalAction` helper to block export/send for draft proposals.

- Modify: `packages/business/src/index.ts`
  - Export revenue core helpers.

- Create: `docs/12_VERIFICATION/w3-w4-revenue-core-runbook.md`
  - Manual verification commands and role scenarios.

## Task 1: Harden Quote Engine Commercial Gate

**Files:**
- Modify: `packages/business/src/quote-engine.ts`
- Create: `packages/business/src/quote-engine.test.ts`

**Interfaces:**
- Produces: `calculateQuote(lineItems: QuoteLineItem[]): QuoteResult` with existing fields plus `approvalDecision`.
- Produces: validation errors `quote_quantity_must_be_positive`, `quote_price_must_be_non_negative`, `quote_discount_must_be_percentage`.

Steps:

- [ ] Write tests in `packages/business/src/quote-engine.test.ts` for healthy quote, low margin approval, high discount approval, and invalid discount rejection.
- [ ] Run `pnpm --dir packages/business exec vitest run src/quote-engine.test.ts` and verify RED.
- [ ] Implement validation and `approvalDecision` in `quote-engine.ts` using existing `calculateQuote` behavior.
- [ ] Run `pnpm --dir packages/business exec vitest run src/quote-engine.test.ts` and verify GREEN.
- [ ] Commit `feat(business): harden quote commercial gate`.

## Task 2: Add Revenue Core Approval Queue Filters and Proposal Action Guard

**Files:**
- Create: `packages/business/src/revenue-core.ts`
- Create: `packages/business/src/revenue-core.test.ts`
- Modify: `packages/business/src/proposal-generator.ts`
- Modify: `packages/business/src/index.ts`

**Interfaces:**
- Produces: `filterRevenueApprovalQueue(items, filter)`.
- Produces: `evaluateProposalAction({ status, action })` returning `{ allowed, reason? }`.
- Proposal actions `send`, `export`, `share` are blocked unless status is `approved`.

Steps:

- [ ] Write tests for role/type/status approval queue filters and proposal action blocking.
- [ ] Run `pnpm --dir packages/business exec vitest run src/revenue-core.test.ts` and verify RED.
- [ ] Implement `revenue-core.ts` and export it.
- [ ] Add `evaluateProposalAction` to `proposal-generator.ts` and use it from `revenue-core.ts` if needed.
- [ ] Run `pnpm --dir packages/business exec vitest run src/revenue-core.test.ts` and verify GREEN.
- [ ] Commit `feat(business): add revenue approval queue guards`.

## Task 3: Add W3-W4 Revenue Runbook

**Files:**
- Create: `docs/12_VERIFICATION/w3-w4-revenue-core-runbook.md`

Steps:

- [ ] Create runbook with focused tests, typecheck, build, and no-external-send caveat.
- [ ] Run focused tests plus `pnpm typecheck`.
- [ ] Commit `docs(revenue): add W3-W4 revenue core runbook`.

## Final Verification

Run:

```bash
pnpm --dir packages/business exec vitest run src/quote-engine.test.ts src/revenue-core.test.ts src/commercial-approval.test.ts
pnpm typecheck
pnpm test
pnpm build
```

## Self-Review

Spec coverage: opportunity/quote/proposal approval baseline is covered by quote gate, proposal action guard, approval queue filters, and runbook. External send/export remains blocked by design. No placeholder sections remain.
