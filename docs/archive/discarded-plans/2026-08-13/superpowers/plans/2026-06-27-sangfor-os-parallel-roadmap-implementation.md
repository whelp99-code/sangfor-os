# Sangfor OS Parallel Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accelerate the 12-week `sangfor-os` roadmap by splitting W3-W6 work into independent UI/API, business/domain, and QA/runbook packets that can be executed by parallel agents and merged under a single verification gate.

**Architecture:** Keep domain logic in `packages/business`, UI/API wiring in `apps/web`, and verification/runbooks in `docs/12_VERIFICATION` plus focused tests. Use additive helpers and dev/demo-safe gates only; external send/export/share actions remain blocked unless explicitly approved.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Prisma 6, Next.js 16 App Router, Markdown runbooks.

## Global Constraints

- Work in `/Users/jmpark/Playground/sangfor-os` on branch `continue-mail-candidate-connection-ui` or an isolated worktree branch.
- Follow TDD: write failing tests, verify RED, implement minimal code, verify GREEN.
- Do not send real mail, deploy, mutate production DBs, force push, or create release tags.
- External send/export/share actions must remain blocked unless explicitly approved.
- AI output is draft until reviewed and approved.
- Keep DB changes additive.
- Before editing files under `apps/web`, read the relevant local Next.js docs in `apps/web/node_modules/next/dist/docs/`; for route handlers use `01-app/01-getting-started/15-route-handlers.md`.
- Do not commit local scratch directories `.serena/`, `.superpowers/`, or `memory/`.
- Do not commit generated `apps/web/next-env.d.ts` unless the task explicitly verifies this is an intended source-controlled change.

---

## File Structure

### Cursor-role UI/API packets

- Modify: `apps/web/src/app/(portal)/proposals/[id]/page.tsx`
  - Shows proposal action guard state for `send`, `export`, and `share`.
- Modify: `apps/web/src/app/api/proposals/[id]/route.ts`
  - Returns proposal action guard metadata for UI consumption.
- Modify: `apps/web/src/app/(portal)/approvals/page.tsx`
  - Adds query-driven role/type/status filters for revenue approval items.
- Modify or create: `apps/web/src/components/approvals/revenue-approval-filters.tsx`
  - Client-safe filter control component if the existing approvals page has no focused component.
- Modify: `apps/web/src/app/cfo/(cfo)/dashboard/page.tsx`
  - Adds commercial approval summary cards using local/demo data or existing API data only.

### Codex-role business/domain packets

- Modify: `packages/business/src/opportunity-stage.ts`
  - Adds explicit qualification transition helper.
- Modify: `packages/business/src/opportunity-center.ts`
  - Exposes opportunity qualification summary helper if existing structure supports it.
- Modify: `packages/business/src/deal-qualification.ts`
  - Keeps server-side qualification score rules reusable.
- Modify: `packages/business/src/quote-engine.ts`
  - Adds quote snapshot/versioning helper and immutable approved quote guard.
- Modify: `packages/business/src/revenue-core.ts`
  - Adds revenue approval summary and audit/evidence payload helpers.
- Modify: `packages/business/src/audit.ts` or `packages/business/src/audit-chain.ts`
  - Only if existing helpers provide a clear event payload pattern; otherwise keep payload helper pure in `revenue-core.ts`.

### AGY-role QA/runbook packets

- Modify: `docs/12_VERIFICATION/w3-w4-revenue-core-runbook.md`
  - Extends from focused helper tests to full role scenario.
- Create: `docs/12_VERIFICATION/w3-w4-revenue-demo-script.md`
  - Sales/Presales/CFO full revenue smoke script.
- Create: `docs/12_VERIFICATION/unsafe-action-matrix.md`
  - Role/action/status matrix for blocked actions.
- Create: `docs/12_VERIFICATION/verification-command-matrix.md`
  - Maps W1-W6 readiness checks to commands.
- Modify: `packages/business/src/revenue-core.test.ts`
  - Adds unsafe action and revenue approval scenario tests if not already covered by task packets.

---

### Task 1: Codex-role Opportunity Qualification Completion

**Files:**
- Modify: `packages/business/src/opportunity-stage.ts`
- Modify: `packages/business/src/opportunity-center.ts`
- Modify: `packages/business/src/deal-qualification.ts`
- Test: `packages/business/src/deal-qualification.test.ts`
- Test: create or modify `packages/business/src/opportunity-stage.test.ts`

**Interfaces:**
- Consumes: existing opportunity/deal qualification helpers.
- Produces:
  - `evaluateOpportunityQualification(input: OpportunityQualificationInput): OpportunityQualificationDecision`
  - `canTransitionOpportunityStage(input: OpportunityStageTransitionInput): OpportunityStageTransitionDecision`
  - `OpportunityQualificationDecision.status` as `"needs_discovery" | "qualified" | "requires_review"`

- [ ] **Step 1: Inspect existing opportunity symbols**

Run:

```bash
pnpm --dir packages/business exec vitest run src/deal-qualification.test.ts
```

Expected: existing tests pass before changes.

- [ ] **Step 2: Write failing qualification tests**

Add tests to `packages/business/src/deal-qualification.test.ts` or create `packages/business/src/opportunity-stage.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";

import {
  canTransitionOpportunityStage,
  evaluateOpportunityQualification,
} from "./opportunity-stage";

describe("opportunity qualification completion", () => {
  it("marks opportunity qualified when score and required discovery fields are present", () => {
    expect(
      evaluateOpportunityQualification({
        bantScore: 82,
        hasBudget: true,
        hasAuthority: true,
        hasNeed: true,
        hasTimeline: true,
        hasDiscoveryNote: true,
        hasSolutionFit: true,
      }),
    ).toEqual({
      status: "qualified",
      reasons: [],
      nextStage: "qualified",
    });
  });

  it("requires review when score is high but solution fit is missing", () => {
    expect(
      evaluateOpportunityQualification({
        bantScore: 82,
        hasBudget: true,
        hasAuthority: true,
        hasNeed: true,
        hasTimeline: true,
        hasDiscoveryNote: true,
        hasSolutionFit: false,
      }),
    ).toMatchObject({
      status: "requires_review",
      reasons: ["missing_solution_fit"],
    });
  });

  it("blocks quote stage transition before qualification", () => {
    expect(
      canTransitionOpportunityStage({
        from: "discovery",
        to: "quote",
        qualificationStatus: "needs_discovery",
      }),
    ).toEqual({ allowed: false, reason: "opportunity_must_be_qualified" });
  });
});
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --dir packages/business exec vitest run src/deal-qualification.test.ts src/opportunity-stage.test.ts
```

Expected: FAIL because new exports are missing or behavior is not implemented.

- [ ] **Step 4: Implement minimal pure helpers**

Add to `packages/business/src/opportunity-stage.ts`:

```ts
export type OpportunityQualificationInput = {
  bantScore: number;
  hasBudget: boolean;
  hasAuthority: boolean;
  hasNeed: boolean;
  hasTimeline: boolean;
  hasDiscoveryNote: boolean;
  hasSolutionFit: boolean;
};

export type OpportunityQualificationStatus = "needs_discovery" | "qualified" | "requires_review";

export type OpportunityQualificationDecision = {
  status: OpportunityQualificationStatus;
  reasons: string[];
  nextStage: "discovery" | "qualified";
};

export type OpportunityStageTransitionInput = {
  from: string;
  to: string;
  qualificationStatus: OpportunityQualificationStatus;
};

export type OpportunityStageTransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: "opportunity_must_be_qualified" };

export function evaluateOpportunityQualification(
  input: OpportunityQualificationInput,
): OpportunityQualificationDecision {
  const reasons: string[] = [];
  if (!input.hasBudget) reasons.push("missing_budget");
  if (!input.hasAuthority) reasons.push("missing_authority");
  if (!input.hasNeed) reasons.push("missing_need");
  if (!input.hasTimeline) reasons.push("missing_timeline");
  if (!input.hasDiscoveryNote) reasons.push("missing_discovery_note");
  if (!input.hasSolutionFit) reasons.push("missing_solution_fit");
  if (!Number.isFinite(input.bantScore) || input.bantScore < 70) reasons.push("low_bant_score");

  if (reasons.length === 0) {
    return { status: "qualified", reasons: [], nextStage: "qualified" };
  }

  const status = input.bantScore >= 70 && input.hasDiscoveryNote ? "requires_review" : "needs_discovery";
  return { status, reasons, nextStage: "discovery" };
}

export function canTransitionOpportunityStage(
  input: OpportunityStageTransitionInput,
): OpportunityStageTransitionDecision {
  if (input.to === "quote" && input.qualificationStatus !== "qualified") {
    return { allowed: false, reason: "opportunity_must_be_qualified" };
  }
  return { allowed: true };
}
```

If `opportunity-stage.ts` already defines conflicting stage names, adapt the union to existing names and keep the error reason exact.

- [ ] **Step 5: Run GREEN**

Run:

```bash
pnpm --dir packages/business exec vitest run src/deal-qualification.test.ts src/opportunity-stage.test.ts
pnpm --filter @sangfor/business typecheck
```

Expected: tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/opportunity-stage.ts packages/business/src/opportunity-stage.test.ts packages/business/src/deal-qualification.test.ts packages/business/src/deal-qualification.ts packages/business/src/opportunity-center.ts
git commit -m "feat(business): complete opportunity qualification gate"
```

---

### Task 2: Codex-role Quote Versioning and Immutability

**Files:**
- Modify: `packages/business/src/quote-engine.ts`
- Modify: `packages/business/src/quote-engine.test.ts`

**Interfaces:**
- Consumes: `calculateQuote(lineItems: QuoteLineItem[]): QuoteResult`.
- Produces:
  - `createQuoteSnapshot(input: QuoteSnapshotInput): QuoteSnapshot`
  - `evaluateQuoteMutation(input: QuoteMutationInput): QuoteMutationDecision`
  - Approved quote mutations return `{ allowed: false, reason: "approved_quote_is_immutable" }`.

- [ ] **Step 1: Write failing tests**

Append to `packages/business/src/quote-engine.test.ts`:

```ts
import { createQuoteSnapshot, evaluateQuoteMutation } from "./quote-engine";

describe("quote versioning and immutability", () => {
  it("creates an immutable quote snapshot from calculated quote output", () => {
    const quote = calculateQuote([
      { productName: "HCI", quantity: 1, unitPrice: 100_000, costPrice: 60_000, discountPct: 5 },
    ]);

    expect(
      createQuoteSnapshot({ quoteId: "quote-1", version: 1, status: "draft", quote }),
    ).toMatchObject({
      quoteId: "quote-1",
      version: 1,
      status: "draft",
      totalRevenue: 95_000,
      approvalDecision: { decision: "allowed" },
    });
  });

  it("blocks mutation after quote approval", () => {
    expect(evaluateQuoteMutation({ status: "approved", action: "edit-line-items" })).toEqual({
      allowed: false,
      reason: "approved_quote_is_immutable",
    });
  });

  it("allows draft quote mutation", () => {
    expect(evaluateQuoteMutation({ status: "draft", action: "edit-line-items" })).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --dir packages/business exec vitest run src/quote-engine.test.ts
```

Expected: FAIL because `createQuoteSnapshot` and `evaluateQuoteMutation` are missing.

- [ ] **Step 3: Implement helpers**

Add to `packages/business/src/quote-engine.ts`:

```ts
export type QuoteLifecycleStatus = "draft" | "ready_for_approval" | "approved" | "rejected";

export type QuoteSnapshotInput = {
  quoteId: string;
  version: number;
  status: QuoteLifecycleStatus;
  quote: QuoteResult;
};

export type QuoteSnapshot = {
  quoteId: string;
  version: number;
  status: QuoteLifecycleStatus;
  lineItems: QuoteResult["lineItems"];
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  overallMarginPct: number;
  approvalDecision: QuoteResult["approvalDecision"];
};

export type QuoteMutationInput = {
  status: QuoteLifecycleStatus | string;
  action: "edit-line-items" | "change-discount" | "submit-for-approval" | string;
};

export type QuoteMutationDecision =
  | { allowed: true }
  | { allowed: false; reason: "approved_quote_is_immutable" };

export function createQuoteSnapshot(input: QuoteSnapshotInput): QuoteSnapshot {
  return {
    quoteId: input.quoteId,
    version: input.version,
    status: input.status,
    lineItems: input.quote.lineItems,
    totalRevenue: input.quote.totalRevenue,
    totalCost: input.quote.totalCost,
    totalMargin: input.quote.totalMargin,
    overallMarginPct: input.quote.overallMarginPct,
    approvalDecision: input.quote.approvalDecision,
  };
}

export function evaluateQuoteMutation(input: QuoteMutationInput): QuoteMutationDecision {
  if (input.status === "approved" && input.action !== "submit-for-approval") {
    return { allowed: false, reason: "approved_quote_is_immutable" };
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm --dir packages/business exec vitest run src/quote-engine.test.ts
pnpm --filter @sangfor/business typecheck
```

Expected: tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/quote-engine.ts packages/business/src/quote-engine.test.ts
git commit -m "feat(business): add quote versioning guard"
```

---

### Task 3: Cursor-role Proposal Action Guard UI/API

**Files:**
- Modify: `apps/web/src/app/api/proposals/[id]/route.ts`
- Modify: `apps/web/src/app/(portal)/proposals/[id]/page.tsx`
- Test: add or modify web tests only if an existing nearby pattern exists.

**Interfaces:**
- Consumes: `evaluateProposalAction({ status, action })` from `@sangfor/business`.
- Produces: proposal detail UI that visibly blocks `send`, `export`, and `share` for non-approved proposals.

- [ ] **Step 1: Read local Next route handler docs**

Run:

```bash
sed -n '1,120p' apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

Expected: App Router route handler conventions are visible.

- [ ] **Step 2: Inspect proposal route/page**

Run:

```bash
grep -R "getGeneratedDocumentDetail\|listGeneratedDocuments\|proposal" -n apps/web/src/app/api/proposals apps/web/src/app/\(portal\)/proposals | head -80
```

Expected: current proposal route/page data flow is visible.

- [ ] **Step 3: Add API guard metadata**

In `apps/web/src/app/api/proposals/[id]/route.ts`, include action guard metadata in the JSON response for detail GET responses:

```ts
import { evaluateProposalAction } from "@sangfor/business";

const proposalActions = ["send", "export", "share"] as const;

function buildProposalActionGuards(status: string) {
  return Object.fromEntries(
    proposalActions.map((action) => [action, evaluateProposalAction({ status, action })]),
  );
}
```

Attach `actionGuards: buildProposalActionGuards(document.status)` to the detail payload. If the route currently returns raw Prisma objects, wrap it as `{ document, actionGuards }` only if no caller expects the raw object; otherwise add `actionGuards` as an extra property on the returned object.

- [ ] **Step 4: Add UI blocked-state rendering**

In `apps/web/src/app/(portal)/proposals/[id]/page.tsx`, render a section with three actions:

```tsx
const proposalActions = ["send", "export", "share"] as const;

function ProposalActionGuardList({ status }: { status: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {proposalActions.map((action) => {
        const decision = evaluateProposalAction({ status, action });
        return (
          <div key={action} className="rounded border p-3 text-sm">
            <div className="font-medium">{action}</div>
            <div className={decision.allowed ? "text-green-600" : "text-muted-foreground"}>
              {decision.allowed ? "allowed" : decision.reason}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Place it near proposal status/details. Import `evaluateProposalAction` from `@sangfor/business` only in a server component. If the page is a client component, move the decisions to the API response or a small server component.

- [ ] **Step 5: Verify**

```bash
pnpm --filter @sangfor/web typecheck
pnpm build
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add 'apps/web/src/app/api/proposals/[id]/route.ts' 'apps/web/src/app/(portal)/proposals/[id]/page.tsx'
git commit -m "feat(web): show proposal action approval guards"
```

---

### Task 4: Cursor-role Revenue Approval Queue Filters and CFO Cards

**Files:**
- Modify: `apps/web/src/app/(portal)/approvals/page.tsx`
- Modify: `apps/web/src/app/cfo/(cfo)/dashboard/page.tsx`
- Create: `apps/web/src/components/approvals/revenue-approval-filters.tsx` if no focused component exists.

**Interfaces:**
- Consumes: `filterRevenueApprovalQueue(items, filter)` from `@sangfor/business`.
- Produces: role/type/status filter UI and CFO commercial approval summary cards.

- [ ] **Step 1: Inspect current pages**

```bash
grep -R "approvals\|approval" -n 'apps/web/src/app/(portal)/approvals/page.tsx' 'apps/web/src/app/cfo/(cfo)/dashboard/page.tsx' apps/web/src/components | head -120
```

Expected: current page structure and component patterns are visible.

- [ ] **Step 2: Add local demo approval items**

If no API-backed revenue approval list exists, add local demo data inside `approvals/page.tsx`:

```ts
const revenueApprovalItems = [
  { id: "quote-demo-low-margin", itemType: "quote", status: "ready_for_human_approval", ownerRole: "cfo", priority: "high" },
  { id: "proposal-demo-draft", itemType: "proposal", status: "draft", ownerRole: "sales", priority: "normal" },
  { id: "discount-demo", itemType: "discount", status: "ready_for_human_approval", ownerRole: "cfo", priority: "normal" },
] as const;
```

Use `filterRevenueApprovalQueue` with URL search params or local selected filters. If the page is server-rendered, read `searchParams` and pass the filter object to the helper.

- [ ] **Step 3: Render filters**

Render links or controls for:

```text
ownerRole: all | sales | presales | cfo
itemType: all | quote | proposal | discount
status: all | draft | ready_for_human_approval | approved | rejected
```

Each filtered view must show count and empty state text `No revenue approvals match this filter.`.

- [ ] **Step 4: Add CFO summary cards**

In `apps/web/src/app/cfo/(cfo)/dashboard/page.tsx`, add cards with:

```text
Pending commercial approvals
Low margin quotes
High discount requests
```

Use local/demo safe data only. Do not create send/export/share actions.

- [ ] **Step 5: Verify**

```bash
pnpm --filter @sangfor/web typecheck
pnpm build
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add 'apps/web/src/app/(portal)/approvals/page.tsx' 'apps/web/src/app/cfo/(cfo)/dashboard/page.tsx' apps/web/src/components/approvals/revenue-approval-filters.tsx
git commit -m "feat(web): add revenue approval queue filters"
```

If `revenue-approval-filters.tsx` was not created, omit it from `git add`.

---

### Task 5: AGY-role Unsafe Action Matrix

**Files:**
- Modify: `packages/business/src/revenue-core.test.ts`
- Create: `docs/12_VERIFICATION/unsafe-action-matrix.md`

**Interfaces:**
- Consumes: `evaluateProposalAction` from `./proposal-generator` and shared unsafe action definitions from `@sangfor/shared`.
- Produces: automated regression coverage and manual matrix documentation for unsafe actions.

- [ ] **Step 1: Write failing tests**

Append to `packages/business/src/revenue-core.test.ts`:

```ts
import { UNSAFE_ACTIONS, requiresApprovalForAction } from "@sangfor/shared/modes";

describe("unsafe action matrix", () => {
  it("keeps customer-facing proposal actions blocked until approval", () => {
    for (const action of ["send", "export", "share"] as const) {
      expect(evaluateProposalAction({ status: "draft", action })).toEqual({
        allowed: false,
        reason: "proposal_action_requires_approval",
      });
      expect(evaluateProposalAction({ status: "approved", action })).toEqual({ allowed: true });
    }
  });

  it("keeps shared unsafe actions approval-gated", () => {
    expect(UNSAFE_ACTIONS).toEqual(
      expect.arrayContaining([
        "send",
        "export",
        "share",
        "delete",
        "deploy",
        "real-upstream-write",
        "production-db-mutation",
        "release-tag",
      ]),
    );
    for (const action of UNSAFE_ACTIONS) {
      expect(requiresApprovalForAction(action)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run RED or confirm existing coverage**

```bash
pnpm --dir packages/business exec vitest run src/revenue-core.test.ts
```

Expected: FAIL only if imports or behavior need wiring; if it passes immediately, record that existing implementation already satisfies this matrix.

- [ ] **Step 3: Implement only if needed**

If tests fail due to missing imports, adjust test imports. If behavior fails, fix the domain helper causing the failure without adding external side effects.

- [ ] **Step 4: Create matrix doc**

Create `docs/12_VERIFICATION/unsafe-action-matrix.md`:

```md
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
```

- [ ] **Step 5: Verify**

```bash
pnpm --dir packages/shared exec vitest run src/modes.test.ts
pnpm --dir packages/business exec vitest run src/revenue-core.test.ts
pnpm typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/revenue-core.test.ts docs/12_VERIFICATION/unsafe-action-matrix.md
git commit -m "test(ops): add unsafe action regression matrix"
```

---

### Task 6: AGY-role W3-W4 Revenue Smoke and Verification Command Matrix

**Files:**
- Modify: `docs/12_VERIFICATION/w3-w4-revenue-core-runbook.md`
- Create: `docs/12_VERIFICATION/w3-w4-revenue-demo-script.md`
- Create: `docs/12_VERIFICATION/verification-command-matrix.md`

**Interfaces:**
- Consumes: W1-W2/W3-W4 test commands and safety constraints.
- Produces: operator-readable smoke path and command matrix.

- [ ] **Step 1: Extend W3-W4 runbook**

Append to `docs/12_VERIFICATION/w3-w4-revenue-core-runbook.md`:

```md
## Full revenue smoke path

1. Sales creates or selects a customer/contact.
2. Sales creates an opportunity and completes qualification evidence.
3. Presales confirms discovery note and solution fit evidence.
4. Sales creates a quote draft.
5. Low-margin or high-discount quote returns `requires_approval`.
6. CFO reviews commercial approval queue.
7. Proposal remains draft until approved.
8. `send`, `export`, and `share` remain blocked before approval.
9. Approved artifact state is visible without executing external send/export/share.

## Required W3-W4 gate

```bash
pnpm --dir packages/business exec vitest run src/quote-engine.test.ts src/revenue-core.test.ts src/commercial-approval.test.ts src/deal-qualification.test.ts
pnpm --filter @sangfor/business typecheck
pnpm typecheck
pnpm test
pnpm build
```
```

- [ ] **Step 2: Create demo script**

Create `docs/12_VERIFICATION/w3-w4-revenue-demo-script.md`:

```md
# W3-W4 Revenue Demo Script

## Safety

This script does not send, export, share, deploy, mutate production DBs, create release tags, or write to real upstream systems.

## Roles

- Sales: creates opportunity, quote draft, and proposal draft.
- Presales: verifies discovery and solution fit evidence.
- CFO: reviews low-margin and high-discount approval state.
- Security: confirms unsafe actions remain blocked.
- Operator: runs verification commands.

## Demo flow

1. Open `/opportunities` and create or inspect an opportunity.
2. Confirm qualification status is `qualified` before quote routing.
3. Open `/approvals` with CFO filter and confirm commercial approval items are visible.
4. Open `/proposals` and inspect a draft proposal.
5. Confirm `send`, `export`, and `share` show blocked state before approval.
6. Run the W3-W4 focused tests.
7. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before claiming readiness.

## Acceptance

The demo passes only when unsafe customer-facing actions are visibly blocked before approval and all required commands pass.
```

- [ ] **Step 3: Create command matrix**

Create `docs/12_VERIFICATION/verification-command-matrix.md`:

```md
# Verification Command Matrix

## W1-W2 Stabilization

| Area | Command |
| --- | --- |
| Mode matrix | `pnpm --dir packages/shared exec vitest run src/modes.test.ts` |
| Readiness summary | `pnpm --dir packages/business exec vitest run src/stabilization-readiness.test.ts` |
| Mail candidate loop | `pnpm --dir packages/business exec vitest run src/mail-candidates.test.ts src/mail-candidate-connections.test.ts` |
| Health script syntax | `bash -n scripts/health-check.sh` |

## W3-W4 Revenue Core

| Area | Command |
| --- | --- |
| Quote/commercial gate | `pnpm --dir packages/business exec vitest run src/quote-engine.test.ts src/commercial-approval.test.ts` |
| Revenue queue and proposal guard | `pnpm --dir packages/business exec vitest run src/revenue-core.test.ts` |
| Opportunity qualification | `pnpm --dir packages/business exec vitest run src/deal-qualification.test.ts src/opportunity-stage.test.ts` |

## Full local gate

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Caveats

`pnpm lint` is desired but not a clean readiness signal until ESLint resolution is repaired across the workspace.
```

- [ ] **Step 4: Verify docs and commands**

```bash
pnpm --dir packages/business exec vitest run src/quote-engine.test.ts src/revenue-core.test.ts src/commercial-approval.test.ts
pnpm typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/12_VERIFICATION/w3-w4-revenue-core-runbook.md docs/12_VERIFICATION/w3-w4-revenue-demo-script.md docs/12_VERIFICATION/verification-command-matrix.md
git commit -m "docs(revenue): add W3-W4 smoke matrix"
```

---

## Merge Order

1. Task 1: Opportunity qualification completion.
2. Task 2: Quote versioning and immutability.
3. Task 3: Proposal action guard UI/API.
4. Task 4: Revenue approval queue filters and CFO cards.
5. Task 5: Unsafe action matrix.
6. Task 6: Revenue smoke and verification command matrix.

This order keeps domain interfaces ahead of UI consumers and lets QA/runbook tasks validate the final combined behavior.

## Final Verification

After all tasks are merged into the coordination branch, run:

```bash
pnpm --dir packages/shared exec vitest run src/modes.test.ts
pnpm --dir packages/business exec vitest run src/quote-engine.test.ts src/revenue-core.test.ts src/commercial-approval.test.ts src/deal-qualification.test.ts src/stabilization-readiness.test.ts
pnpm --filter @sangfor/business typecheck
pnpm --filter @sangfor/web typecheck
pnpm typecheck
pnpm test
pnpm build
bash -n scripts/health-check.sh
```

If local web is running, also run:

```bash
curl -s http://localhost:3101/proposals | grep -E "Proposal|proposal"
curl -s http://localhost:3101/approvals | grep -E "Approval|approval"
curl -s http://localhost:3101/cfo/dashboard | grep -E "CFO|Commercial|approval"
```

## Self-Review

Spec coverage:
- W3-W4 opportunity qualification: Task 1.
- W3-W4 quote/commercial hardening continuation: Task 2.
- W3-W4 proposal action blocking in UI/API: Task 3.
- W3-W4 approval queue ergonomics and CFO surface: Task 4.
- Cross-cutting unsafe action regression: Task 5.
- QA/runbook/smoke readiness: Task 6.

Placeholder scan:
- No `TBD`, `TODO`, `fill in`, or unspecified implementation placeholders remain.

Type consistency:
- `evaluateOpportunityQualification`, `canTransitionOpportunityStage`, `createQuoteSnapshot`, `evaluateQuoteMutation`, `filterRevenueApprovalQueue`, and `evaluateProposalAction` are named consistently where consumed.
