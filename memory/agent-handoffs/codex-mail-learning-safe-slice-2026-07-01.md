# Codex Mail Learning Safe Slice Handoff - 2026-07-01

Author: Codex
Status: C safe slice implemented, not yet integrated into CRM mutation flow

## Decision

The mail-learning goal is not "train on incoming mail immediately." The goal is a governed closed loop where reviewed business decisions become reusable learning data. Raw AI output must remain a draft until human approval.

This slice establishes the first contract in `@sangfor/mail-intelligence`:

- `MailClassificationDecision`
- `computeMailUncertainty(decision)`
- `projectMailCandidateType(decision)`

The existing CRM mail flow remains intact:

`MailInsightThread -> MailDerivedCandidate -> MailEvidenceLink -> human approve/connect`

## Taxonomy Axes

Mail should be classified across these axes before it becomes a CRM candidate:

- `actorRole`: `customer`, `partner`, `vendor`, `internal`, `system_sender`, `unknown`
- `businessIntent`: `opportunity`, `renewal`, `poc`, `support`, `delivery`, `finance`, `legal`, `meeting`, `task`, `knowledge_only`
- `workflowStage`: `new_lead`, `discovery`, `proposal`, `approval`, `delivery`, `renewal`, `support`
- `actionability`: `ignore`, `reference`, `draft_task`, `review_candidate`, `auto_link_only`
- `riskClass`: `public`, `internal`, `confidential`, `credential_payment_regulated`

The legacy candidate vocabulary is preserved as a compatibility projection:

- `customer`
- `partner`
- `task`
- `opportunity`
- `poc`

## Review Gate

`computeMailUncertainty` raises review for:

- low model confidence
- low rule confidence
- low entity resolution confidence
- duplicate probability
- rule/model conflict
- taxonomy disagreement
- new participant domain
- historically corrected sender
- high risk class
- unsafe actionability

High-risk classes require review even when model confidence is high.

## External Research Used

- Gmail category sorting combines sender, content, and user interaction signals.
- Zendesk intelligent triage treats classification as routing, priority, and SLA input.
- Front and Salesforce support routing patterns show that classification should feed operational queues, not just labels.
- Microsoft Graph delta and change notifications are the right sync primitives for incremental mailbox ingestion.
- OpenAI eval guidance supports human-validated evals before model/prompt optimization.
- NIST AI RMF supports privacy, security, accountability, and risk controls.
- Email weak-supervision research supports using user actions as weak labels, while keeping clean human labels separate.

## Next Integration Targets

1. Route `packages/business/src/mail-candidates.ts` classification output through `MailClassificationDecision`.
2. Replace single `confidence` gating with `computeMailUncertainty`.
3. Integrate `mail-entity-quality.ts` suppression into the main generator path.
4. Split policy memory from labeled training/evaluation examples.
5. Resolve duplicated thread generation paths:
   - `apps/web/src/lib/mail-learning.ts`
   - `apps/web/src/app/api/mail-insight-threads/generate/route.ts`
6. Standardize approval semantics so "approve" and "convert/connect" are not mixed across endpoints.

## Verification

Commands run:

```bash
pnpm --filter @sangfor/mail-intelligence exec vitest run src/contract.test.ts
pnpm --filter @sangfor/mail-intelligence test
pnpm --filter @sangfor/mail-intelligence typecheck
```

Result:

- 5 tests passed
- typecheck passed
