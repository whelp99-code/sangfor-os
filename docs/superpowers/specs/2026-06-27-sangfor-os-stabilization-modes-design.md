# Sangfor OS Stabilization, Mode Activation, and Product Hardening Design

## 1. Purpose

`sangfor-os` is now the canonical integration repository for the AIOS/SANGFOR operating platform. The first real-mail candidate approval issue has been stabilized enough to move from isolated bug fixing into a structured product program.

This document defines a 12-week development plan for:

1. stabilizing all current product surfaces,
2. activating role, AI, and environment modes,
3. hardening product workflows through evidence, approval gates, and observability,
4. producing executable W1-W2 PR plans that can start immediately.

The plan combines a 12-week master roadmap with detailed W1-W2 PR-level execution.

## 2. Current Context

### Repository direction

`sangfor-os` is a modular monorepo that integrates:

- `apps/web`: Next.js operator/business portal.
- `apps/api`: API gateway and integration surface.
- `packages/business`: current domain/application logic for CRM, opportunity, approval, mail, PoC, proposal, workflow, and AI quality gates.
- `packages/finance`: CFO/finance engine.
- `packages/db`: canonical Prisma schema.
- `packages/auth`, `packages/security`, `packages/infra`, `packages/health`: foundation and operating controls.
- `packages/mail-intelligence`: mail pipeline assets.
- `packages/proxy-core`: bridge/proxy layer for preserved legacy assets.
- `services/sangfor-mcp-workflow`, `services/sangfor-engineer-mcp`: wrapped MCP services.

### Recent baseline

The real-mail hardening branch introduced or verified:

- SQLite fallback ingest from `/Users/jmpark/.mail-intel/data.db`.
- `legacyKnowledgeFallback` candidate generation.
- suppression of internal, system, newsletter, and promotional fallback candidates.
- approve/connect defaults based on sender metadata/domain.
- `MailEvidenceLink` for proposal/customer/opportunity/contact evidence.
- deterministic local seed.
- real-mail hardening runbook.

This becomes the reference pattern for the broader program: real data path, safe defaults, explicit suppression, evidence links, runbook, and verification gates.

## 3. Planning Strategy

Use **three parallel tracks with scenario-based acceptance gates**.

### Track A — Foundation and Operating Modes

Goal: create safe execution conditions shared by every product.

Scope:

- AuthContext.
- RBAC and ABAC.
- tenant/company scoping.
- audit log and evidence baseline.
- health checks and observability.
- environment modes: dev, demo, staging, production.
- upstream modes: mock, real, read-only, write-enabled.
- release and rollback runbooks.

### Track B — Revenue Workflow

Goal: make the core revenue loop reliable from input to approved artifact.

Scope:

- Mail → candidate → approval/connect → CRM/proposal.
- Customer, partner, contact.
- Opportunity and qualification.
- Quote, margin, discount, commercial approval.
- Proposal artifact and evidence.
- Approval queue and role workspaces.

### Track C — Product Expansion and Agent Modes

Goal: activate additional products without losing control of AI and automation.

Scope:

- Finance/CFO workflows.
- Delivery, asset, subscription, renewal.
- Support, RCA, SLA seed.
- MCP workflow service and engineer MCP service.
- RAG/evidence adapters.
- AI draft/review/approve mode.
- color-agent review gates.
- cost and ROI metrics.

## 4. Mode Model

The program activates three mode axes. A feature is not considered production-ready until its required modes are explicit and tested.

### 4.1 Role / Work Mode

Required work modes:

- Sales.
- Presales.
- Delivery.
- Support.
- CFO.
- Operator.
- Security.

Each role mode must define:

- default dashboard entry.
- allowed actions.
- blocked actions.
- approval queue responsibilities.
- evidence visible to the role.
- success scenario.

### 4.2 AI / Agent Execution Mode

Required AI modes:

- `draft`: AI can generate suggestions only.
- `review`: human must inspect and approve.
- `approve`: approved artifact or approved action state.
- `smoke`: small deterministic workflow for tests/demos.
- `full`: complete workflow path.
- `manual`: human-driven execution.
- `assisted`: AI suggests next actions.
- `autonomous`: allowed only for reversible internal operations with explicit guardrails.
- `color-agent-review`: review lane for specialized agents.

Rules:

- AI output is never treated as approved output by default.
- Send/export/share/delete/deploy/write-to-production actions require approval gates.
- Every AI-derived recommendation must keep source evidence or missing-field context.

### 4.3 Product Operating Mode

Required environment/upstream modes:

- `dev`.
- `demo`.
- `staging`.
- `production`.
- `mock-upstream`.
- `real-upstream`.
- `read-only`.
- `write-enabled`.

Rules:

- Real external side effects must be disabled by default in dev/demo.
- Mock upstream and real upstream behavior must be selected explicitly.
- Production DB mutation, real mail sending, deployment, force push, and release tags require explicit final approval.

## 5. 12-Week Master Roadmap

### W1-W2 — Stabilization Baseline

Theme: make the current system safe and repeatable.

Objectives:

- Establish mode matrix and operating contracts.
- Harden real-mail loop after first stabilization.
- Add foundation audit/evidence baseline.
- Define role workspace entry points.
- Create demo seed and smoke scenario pack.

Deliverables:

- mode matrix document and typed config proposal.
- audit/evidence baseline for sensitive workflows.
- mail loop hardening follow-up PRs.
- deal/quote skeleton approval gate baseline.
- role dashboard navigation map.
- health and observability runbook.
- W1-W2 demo script.

Acceptance gate:

- Sales user can ingest or generate candidates, approve/connect one actionable candidate, and see evidence on downstream entities.
- Operator can see health and recent verification status.
- Security can identify gated actions and audit events.
- `pnpm test`, `pnpm typecheck`, `pnpm build` pass.

### W3-W4 — Revenue Core Activation

Theme: close the main sales workflow.

Objectives:

- Stabilize opportunity and qualification stages.
- Add quote/margin and discount approval gates.
- Connect proposal generation to approved opportunity/quote context.
- Improve approval queue ergonomics.
- Keep AI drafts clearly separate from approved artifacts.

Deliverables:

- opportunity qualification flow.
- quote line item and margin calculation hardening.
- commercial gate for low margin/high discount.
- proposal artifact versioning and evidence links.
- role-specific approval queue filters.

Acceptance gate:

- Sales/Presales can create opportunity, qualify it, create quote/proposal draft, route approval, and produce an approved artifact.
- Low-margin quote cannot be exported before approval.
- Audit log records approval decision and source evidence.

### W5-W6 — Finance and Commercial Integration

Theme: connect revenue workflow to CFO workflows.

Objectives:

- Stabilize finance package boundaries.
- Connect approved commercial outputs to invoice/cashflow views.
- Add CFO dashboard mode.
- Add VAT/expense/subscription smoke scenarios.
- Establish finance data guardrails.

Deliverables:

- finance route/API health checks.
- invoice and cashflow integration baseline.
- quote-to-finance handoff design.
- CFO dashboard entry.
- finance runbook.

Acceptance gate:

- CFO can inspect commercial pipeline, invoice state, cashflow summary, and finance health.
- Finance actions use mock/demo data unless explicitly write-enabled.

### W7-W8 — Delivery, Asset, Renewal, and Support

Theme: extend from sale to lifecycle operations.

Objectives:

- Connect accepted opportunity/proposal to delivery checklist.
- Create asset/license/subscription records from accepted delivery.
- Generate renewal opportunities and reminders.
- Add support/RCA workflow baseline.
- Link support cases to assets.

Deliverables:

- delivery checklist flow.
- customer asset and license model verification.
- subscription expiry and renewal generation.
- support case and RCA draft workflow.
- delivery/support role dashboards.

Acceptance gate:

- Delivery can complete a checklist and create an asset/license/subscription.
- Support can create a case linked to customer asset and produce RCA draft with evidence.
- Renewal reminder generation is testable.

### W9-W10 — Agent, MCP, and AI Mode Hardening

Theme: make automation useful without making it unsafe.

Objectives:

- Stabilize MCP service wrappers.
- Define engineer MCP and workflow MCP smoke paths.
- Connect RAG/evidence from MCP outputs to business workflows.
- Add color-agent review status to UI/domain where needed.
- Add prompt/model registry baseline and AI cost tracking.

Deliverables:

- MCP health and smoke runbooks.
- RAG/evidence adapter plan and first implementation PRs.
- AI quality gate enhancements.
- color-agent review queue baseline.
- model/prompt registry dashboard.

Acceptance gate:

- Operator can run smoke MCP workflows without external destructive effects.
- AI/agent output is traceable to evidence and remains draft until reviewed.
- High-risk automation cannot bypass human approval.

### W11-W12 — Operations, ROI, and Release Readiness

Theme: prepare integrated system for sustained operation.

Objectives:

- Consolidate Operator/Security dashboards.
- Add audit health, approval age, system health, and queue health metrics.
- Add ROI and AI cost dashboards.
- Run full demo scripts across roles.
- Prepare release readiness checklist.

Deliverables:

- operator dashboard.
- security dashboard.
- ROI/cost metrics view.
- staging-like smoke runbook.
- release readiness report.
- final gap matrix update.

Acceptance gate:

- Role-based demo across Sales, Presales, CFO, Delivery, Support, Operator, and Security passes.
- Critical actions are gated and audited.
- Runbooks allow a new worker to reproduce smoke checks.
- No critical workflow requires direct use of an old project UI.

## 6. W1-W2 Detailed PR Plan

### PR-01 — Foundation mode matrix and runtime guard baseline

Scope:

- Define role, AI, and environment mode matrix.
- Add a typed configuration shape or documentation that maps modes to allowed actions.
- Identify existing unsafe action surfaces.

Touched areas:

- `docs/`.
- `packages/shared` or `packages/config` if a typed contract is added.
- `packages/business` only for minimal guard interfaces if needed.

Acceptance criteria:

- Mode matrix covers role modes, AI modes, and operating modes.
- Unsafe actions list includes send, export, share, delete, deploy, real upstream write, production DB mutation, and release tagging.
- At least one test or static check validates mode config shape if code is introduced.

Verification:

- `pnpm --filter @sangfor/shared test` if shared code changes.
- `pnpm typecheck`.

Rollback:

- Documentation-only parts can be reverted independently.
- Code contract must be backward-compatible or guarded behind defaults.

### PR-02 — Audit and evidence baseline

Scope:

- Inventory sensitive workflows that need audit events.
- Define a common evidence payload for mail, deal, quote, finance, delivery, and AI outputs.
- Add missing audit/evidence events to the most active workflows.

Touched areas:

- `packages/business`.
- `packages/db`.
- `apps/web` evidence display only if needed.

Acceptance criteria:

- Mail approve/connect has evidence links.
- Deal/quote approval actions have audit/evidence plan or first implementation.
- Evidence payload includes source type, source ID, summary/quote, and created timestamp.

Verification:

- focused business tests.
- DB seed/smoke if schema changes.
- `pnpm typecheck`.

Rollback:

- New evidence tables/fields must be additive.
- No destructive migration in W1-W2.

### PR-03 — Mail loop hardening follow-up

Scope:

- Re-test real-mail SQLite fallback after PR #1.
- Ensure candidate generation processes legacy fallback even when thread rows exist.
- Ensure promotional/internal/system sender suppression covers both new and existing pending candidates.
- Keep runbook current.

Touched areas:

- `scripts/ingest-mail-intelligence-to-knowledge.mjs`.
- `packages/business/src/mail-candidates.ts`.
- `packages/business/src/mail-candidate-connections.ts`.
- `apps/web/src/app/api/mail-candidates/*`.
- `docs/12_VERIFICATION`.

Acceptance criteria:

- Real-mail fallback smoke passes.
- Active internal/newsletter customer candidates are absent from approval queue.
- approve/connect does not leave partial writes on validation failure.
- evidence links are visible on proposal/customer/opportunity pages.

Verification:

- `pnpm exec vitest run scripts/ingest-mail-intelligence-to-knowledge.test.mjs`.
- `pnpm --dir packages/business exec vitest run src/mail-candidates.test.ts src/mail-candidate-connections.test.ts`.
- `CI_INTEGRATION=1 pnpm --dir packages/business exec vitest run src/phase12-mail-candidate-connection.test.ts`.
- real ingest smoke with local `.mail-intel/data.db`.

Rollback:

- Keep DB changes additive.
- Disable `legacyKnowledgeFallback` request option if needed while keeping default false.

### PR-04 — Deal/Quote approval gate baseline

Scope:

- Stabilize opportunity stage normalization.
- Define quote/margin server-side calculation gate.
- Add approval gate skeleton for quote export/send.
- Separate AI draft proposal from approved proposal artifact.

Touched areas:

- `packages/business/src/opportunity-*`.
- `packages/business/src/proposal-generator.ts`.
- quote/commercial modules if present.
- `apps/web` opportunity/proposal pages.

Acceptance criteria:

- Opportunity stage values normalize consistently.
- Quote margin calculation is server-side.
- Low margin or high discount creates approval requirement.
- Proposal export/send path is blocked before approval.

Verification:

- focused opportunity/quote/proposal tests.
- `pnpm --filter @sangfor/business test`.
- role scenario smoke.

Rollback:

- Gate defaults should fail closed for external send/export.
- Existing read-only views remain available.

### PR-05 — Role workspace navigation and dashboard entry

Scope:

- Define role workspace entry points.
- Ensure current navigation exposes Sales, Presales, Delivery, Support, CFO, Operator, and Security paths.
- Add missing dashboard placeholders only when backed by real status or clear runbook links.

Touched areas:

- `apps/web/src/app/*`.
- `apps/web/src/components/layout/*`.
- `packages/business` list/detail functions if needed.

Acceptance criteria:

- Each role has an entry route.
- Each entry route shows at least one actionable queue, health state, or runbook-backed next step.
- No role route claims readiness without evidence.

Verification:

- `pnpm --filter @sangfor/web typecheck`.
- browser smoke for role routes.
- `pnpm build` before merge.

Rollback:

- Navigation additions can be reverted without domain/schema changes.

### PR-06 — Observability and health runbook

Scope:

- Consolidate health checks for web, api, finance, DB, Redis, MCP services, and mock upstreams.
- Document what is required for dev/demo/staging.
- Add health smoke scripts only if they reuse existing endpoints.

Touched areas:

- `scripts/health-check.sh`.
- `packages/health`.
- `packages/infra`.
- `docs/12_VERIFICATION`.

Acceptance criteria:

- One command or runbook checks core local stack health.
- Health output distinguishes unavailable optional service from critical failure.
- Docker and non-Docker local paths are documented.

Verification:

- `pnpm health:check` where available.
- `pnpm docker:dev` smoke.
- service endpoint curl checks.

Rollback:

- Runbook-only fallback if script changes are unstable.

### PR-07 — Demo seed and smoke scenario pack

Scope:

- Extend deterministic seed with safe synthetic data.
- Add scenario scripts for W1-W2 demo.
- Avoid reading private mail or secrets from seed.

Touched areas:

- `packages/db/prisma/seed.ts`.
- `docs/12_VERIFICATION`.
- optional `scripts/demo-*`.

Acceptance criteria:

- `pnpm db:seed` is idempotent.
- Demo data covers at least one customer, contact, opportunity, candidate, approval, proposal, and evidence path.
- Seed never reads `/Users/jmpark/.mail-intel` or private files.

Verification:

- `pnpm db:seed` twice.
- focused smoke route checks.
- `pnpm typecheck`.

Rollback:

- Synthetic seed rows use stable slugs/keys and upsert.

## 7. Cross-Cutting Quality Gates

Every material PR must include:

- scope statement.
- files/packages touched.
- acceptance criteria.
- verification commands.
- rollback note.
- user/demo scenario.
- risk note.

Required command gates by change type:

| Change Type | Required Verification |
| --- | --- |
| Business logic | focused Vitest + `pnpm --filter @sangfor/business typecheck` |
| Web route/UI | local Next docs check where applicable + `pnpm --filter @sangfor/web typecheck` + browser or curl smoke |
| Prisma schema | `pnpm db:push` on local DB + seed if applicable + focused DB query |
| Script | helper tests + dry-run/smoke command |
| Cross-package | `pnpm typecheck` + `pnpm test` |
| Pre-merge | `pnpm build` |

Known caveat:

- `pnpm lint` may be blocked by workspace ESLint resolution. Do not make lint a hard gate until lint dependency setup is explicitly fixed.

## 8. Product Readiness Definition

A product surface is considered activated only when all of the following are true:

1. Role happy path works through UI or documented API.
2. Unsafe actions are behind approval gates.
3. AI-generated outputs are marked as drafts until approved.
4. Evidence or audit trail is attached to material decisions.
5. Demo seed or fixture can reproduce the scenario.
6. Focused tests and typecheck pass.
7. A runbook exists for manual verification.
8. Operator/Security can inspect status, health, or audit evidence.
9. Rollback or disablement path is documented.

## 9. Risks and Mitigations

### Risk: scope too broad for one branch

Mitigation:

- Keep this document as program-level design.
- Create PR-sized implementation plans per W1-W2 item.
- Do not implement multiple tracks in one PR unless the dependency is unavoidable.

### Risk: demo data pollutes real data assumptions

Mitigation:

- Use deterministic synthetic seed only.
- Never read private mail cache from seed.
- Keep real-mail validation in explicit runbooks.

### Risk: AI mode becomes unsafe automation

Mitigation:

- Fail closed for external side effects.
- Track AI output as draft.
- Require review/approval before customer-facing or irreversible actions.

### Risk: legacy service wrappers remain opaque

Mitigation:

- Add smoke checks for wrapped MCP services.
- Absorb reusable logic gradually.
- Keep bridge health visible in Operator mode.

### Risk: PRs become coupled

Mitigation:

- Track dependencies in each PR plan.
- Keep schema changes additive in W1-W2.
- Run integration smoke after every material batch.

## 10. Immediate Next Step

After this design is approved, create an implementation plan for W1-W2 using `superpowers:writing-plans`.

The implementation plan should produce:

- a dependency graph for PR-01 through PR-07,
- detailed task steps per PR,
- exact verification commands,
- review checkpoints,
- branch/commit strategy,
- runbook update requirements.
