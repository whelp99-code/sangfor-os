# Mail Learning Safe Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first safe mail-learning contract for governed multi-axis classification without mutating CRM entities automatically.

**Architecture:** Keep the existing `MailInsightThread -> MailDerivedCandidate -> MailEvidenceLink -> human approve/connect` flow intact. Add a focused `@sangfor/mail-intelligence` contract for classification decisions, uncertainty scoring, and compatibility projection so later business logic can adopt it without a risky rewrite.

**Tech Stack:** TypeScript, Vitest, pnpm workspace package `@sangfor/mail-intelligence`.

## Global Constraints

- Do not change mail ingestion, Outlook sync, CRM conversion, or approval endpoints in this slice.
- Do not allow raw AI output to create or mutate CRM entities.
- Preserve the existing candidate type vocabulary: `customer`, `partner`, `task`, `opportunity`, `poc`.
- Store richer learning semantics as multi-axis classification decisions.
- Follow TDD: write failing tests before production code.

---

### Task 1: Mail Classification Decision Contract

**Files:**
- Modify: `packages/mail-intelligence/src/contract.ts`
- Modify: `packages/mail-intelligence/src/index.ts`
- Test: `packages/mail-intelligence/src/contract.test.ts`
- Modify: `packages/mail-intelligence/package.json`

**Interfaces:**
- Produces: `MailClassificationDecision`
- Produces: `computeMailUncertainty(decision: MailClassificationDecision): MailUncertaintyResult`
- Produces: `projectMailCandidateType(decision: MailClassificationDecision): MailCandidateType | undefined`

- [x] **Step 1: Write failing tests**

Test these behaviors:
- high-risk decisions require review even when model confidence is high
- rule/model conflicts increase uncertainty and require review
- low-risk clear opportunity decisions project to `opportunity`
- vendor/reference decisions do not project to CRM candidate types

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sangfor/mail-intelligence exec vitest run src/contract.test.ts`

Expected: FAIL because `computeMailUncertainty` and `projectMailCandidateType` are not exported.

- [x] **Step 3: Implement minimal contract**

Add type-only taxonomy axes and pure helper functions in `contract.ts`. Keep the implementation dependency-free.

- [x] **Step 4: Run focused tests**

Run: `pnpm --filter @sangfor/mail-intelligence exec vitest run src/contract.test.ts`

Expected: PASS.

- [x] **Step 5: Wire package test script**

Change `@sangfor/mail-intelligence` test script from `echo No tests` to `vitest run`.

- [x] **Step 6: Run package verification**

Run:
- `pnpm --filter @sangfor/mail-intelligence test`
- `pnpm --filter @sangfor/mail-intelligence typecheck`

Expected: PASS.

### Task 2: Handoff Notes

**Files:**
- Create: `memory/agent-handoffs/codex-mail-learning-safe-slice-2026-07-01.md`

**Interfaces:**
- Produces a concise handoff for Claude and future agents.

- [x] **Step 1: Document the new contract**

Include taxonomy axes, review gates, source research summary, and the next integration targets.

- [x] **Step 2: Verify changed files**

Run: `git status --short`

Expected: only the plan, mail-intelligence changes, and handoff note are part of this C slice, plus pre-existing untracked files.
