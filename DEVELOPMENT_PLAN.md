# Sangfor-os Complete Integration Development Plan

## Current Goal

The final goal is complete integration of all AIOS/SANGFOR related projects into
`sangfor-os`. The repo must become the single maintainable modular monolithic
monorepo for the operating platform, while preserving useful legacy assets
through absorption, wrappers, bridges, and adapters.

The implementation baseline is the SANGFOR Partner OS final package:

```text
/Users/jmpark/Downloads/01.Pilot_Coding/agentic_company_os_sangfor_final_package_v3_2/
```

## Current State Snapshot

| Area | State | Next Action |
| --- | --- | --- |
| Source packages/docs | Final package docs are present under `docs/` | Keep docs as product baseline |
| AIOS v1 | Proxy/bridge scripts and adapter exist | Verify feature parity and bridge health |
| Business modules | CRM, PoC, quote, approval, mail, asset/renewal modules exist in `packages/business` | Map to final package milestones |
| Finance | Finance modules exist under `packages/finance` | Connect to commercial workflow and dashboards |
| SANGFOR MCP workflow | Present under `services/sangfor-mcp-workflow` | Keep wrapped service and absorb reusable logic |
| Engineer MCP | Present under `services/sangfor-engineer-mcp` | Keep wrapped service and connect evidence/RAG |
| UX/AI Workspace changes | In-progress uncommitted UI work exists | Triage as keep/defer/realign |
| Verification | `pnpm typecheck` previously passed | Re-run after documentation and code changes |

## Milestone 0: Integration Baseline

### Goal

Fix the direction before deeper implementation. `sangfor-os` must be documented
as the canonical integration repo, not a new UI-only product.

### Work

- Update architecture and development docs to include all source projects.
- Create source inventory and final package gap matrix.
- Classify current UX/AI Workspace changes.
- Keep AIOS v1 as a preserved runtime asset.

### Completion Criteria

- `docs/reports/integration-source-inventory.md` exists.
- `docs/reports/project-to-sangfor-os-mapping.md` exists.
- `docs/reports/final-package-gap-matrix.md` exists.
- `docs/reports/aios-v1-integration-baseline.md` exists.
- Current UX changes are classified.

## Milestone 1: Foundation

### Goal

Implement and verify the final package foundation requirements.

### Scope

- Tenant / Company
- User / AuthContext
- RBAC + ABAC
- PostgreSQL RLS design and migration baseline
- Append-only Audit Log and hash chain
- Basic dashboard and health checks

### Completion Criteria

- Unauthenticated API access is blocked.
- Tenant scope is enforced at API and DB policy design levels.
- Audit events are recorded for sensitive operations.
- RLS migration/test plan exists before any operational DB action.

## Milestone 2: Deal Workflow

### Goal

Close the customer-to-approval workflow.

### Scope

- Customer, Partner, Contact
- Opportunity
- Deal Qualification
- Discovery Note
- Solution Fit Matrix
- Workflow Run and Task
- Approval Gate
- AI Draft vs Approved Artifact separation

### Completion Criteria

- Opportunity can be created and qualified.
- Qualification score is server-calculated.
- Discovery artifact is versioned.
- Solution Fit Gate supports approve/reject/request changes.
- AI Draft cannot be treated as approved output.

## Milestone 3: Quote & Commercial

### Goal

Close the product/SKU/quote/commercial approval workflow.

### Scope

- Product Family and SKU
- Quote and Quote Line Items
- Server-side margin calculation
- Discount Request and Vendor Request
- Commercial Gate
- Proposal Artifact

### Completion Criteria

- Quote margin is calculated on the server.
- Low margin creates approval requirements.
- Customer send/export is blocked before approval.
- Quote versions are immutable after approval.

## Milestone 4: Delivery, Asset & Renewal

### Goal

Connect post-sale operations to assets, subscriptions, renewals, and support.

### Scope

- PoC Plan / Result
- Delivery Checklist
- Customer Asset
- License / Subscription
- Renewal Opportunity and reminders
- Support Case / RCA / SLA seed

### Completion Criteria

- Acceptance creates asset/license/subscription records.
- Expiring subscriptions create renewal opportunities.
- Support cases can link to assets.
- Renewal reminder generation is testable.

## Milestone 5: Controlled AI and Color Agent Review

### Goal

Use AI as a controlled assistant, not an autonomous executor.

### Scope

- Lead Summary
- Discovery Question Generator
- Proposal Draft
- RCA Draft
- AI Quality Gate
- Prompt / Model Registry
- Evidence Link
- Color Agent routing and review gates

### Completion Criteria

- AI Draft send is blocked before human review.
- Source artifacts and missing fields are visible.
- Color Agent review status is represented in UI and domain logic.
- Automatic override of high-risk approvals is not possible.

## Milestone 6: UX, Operations, and ROI

### Goal

Expose the integrated platform through role-based dashboards and operator
workflows.

### Scope

- Role-based dashboard
- Approval Queue
- Mail Intelligence
- Customer / Opportunity
- Quote / Proposal
- PoC / Delivery
- Asset / Renewal
- Support
- Color Agents
- Operator / Security
- ROI and AI cost metrics

### Completion Criteria

- Users can complete the core operating loop in `sangfor-os`.
- No critical workflow requires direct use of an old project UI.
- Operator and Security views expose approval age, audit health, and system
  health.

## Verification Gates

Run these after each material implementation batch:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Run these before claiming integration readiness:

```bash
pnpm build
pnpm test:e2e
```

Use local smoke checks only for read-only or approved actions. Do not send real
mail, deploy, mutate production DBs, force push, or create release tags without
explicit approval.
