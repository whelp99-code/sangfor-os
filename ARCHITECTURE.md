# Sangfor-os Architecture

## Canonical Direction

`sangfor-os` is the canonical integration repository for the whole AIOS/SANGFOR
workbench. It is not a greenfield UX experiment and it is not a document-only
package. It keeps AIOS v1 as an important runtime asset while aligning all
projects to the SANGFOR Partner OS design package.

The source-of-truth product package is:

```text
/Users/jmpark/Downloads/01.Pilot_Coding/agentic_company_os_sangfor_final_package_v3_2/
```

That package defines the product scope, domain model, security requirements,
approval gates, workflow milestones, UX expectations, operating runbooks, and
verification criteria. `sangfor-os` implements those requirements in the local
TypeScript/Turborepo stack.

## Integration Principles

1. Preserve useful existing assets. Prefer absorb, wrap, or bridge over rewrite.
2. Keep `sangfor-os` as the single operator-facing repo and runtime entrypoint.
3. Use the final package milestones as the implementation order.
4. Do not let standalone UX experiments override the business workflow model.
5. Route irreversible actions through approval gates: send, delete, deploy,
   external share, production data mutation, and release operations.
6. Keep evidence, audit logs, and verification reports for migration decisions.

## Source Projects

| Source | Integration Role | Target in `sangfor-os` | Status |
| --- | --- | --- | --- |
| AIOS v1 | Existing runtime, portal behavior, registry, local automation, upstream APIs | `packages/proxy-core`, `apps/web`, `scripts/start-integration-stack.mjs`, bridge/API adapters | Partial, must preserve and verify |
| AIOSv2_integration | Workflow, approval, evidence, collaboration runtime, operating model | `packages/business`, `packages/application`, `packages/infrastructure`, `docs/reports` | Partial |
| F-aios-v3-core | Workflow execution core, agent/runtime patterns, package boundaries | `packages/application`, `packages/business`, bridge adapters | Partial |
| sangfor-mcp-workflow | SANGFOR device workflows, HCI/IAG/EPP knowledge, MCP workflow automation, RAG sources | `services/sangfor-mcp-workflow`, `packages/infrastructure`, RAG adapters | Wrapped service, partially absorbed |
| sangfor-engineer-mcp | Engineer automation, product adapters, RAG, screenshots, operator tooling | `services/sangfor-engineer-mcp`, infrastructure adapters | Wrapped service |
| AIOS-JARVIS | Voice/assistant surface and local operator interaction | `apps/voice` or assistant adapter layer | Planned |
| vibe-coding-os | Agent orchestration and development automation patterns | `tools`, `plugins`, workflow dispatch scripts | Planned/partial |
| CFO/finance apps | Finance, invoice, expense, VAT, cashflow, subscriptions | `packages/finance`, finance API/UI routes | Partial |
| agentic_company_os_sangfor_final_package_v3_2 | Product blueprint, DB/API skeleton, UX, security, operations, acceptance tests | `docs`, `packages/db`, `packages/business`, `apps/api`, `apps/web` | Imported as docs, implementation gap remains |

## Target Repository Shape

```text
sangfor-os/
  apps/
    web              # Next.js portal, role dashboards, approval UI
    api              # Express/tRPC API gateway
    voice            # JARVIS/voice assistant app when integrated
  packages/
    domain           # DDD entities/value objects when split from business
    application      # use cases, workflows, orchestration
    infrastructure   # DB, mail, LLM, RAG, file, external adapters
    business         # current migrated domain/application logic
    db               # Prisma canonical schema
    auth             # AuthContext, RBAC, ABAC, token helpers
    security         # audit, encryption, policy helpers
    finance          # CFO/finance modules
    mail-intelligence
    proxy-core       # AIOS v1/F-aios-v3/service bridges
    shared
    ui
  services/
    sangfor-mcp-workflow
    sangfor-engineer-mcp
  plugins/
  tools/
  tests/
  docs/
    reports/
    evidence/
```

The repo does not need to reach this shape in one change. New work should move
toward this structure and avoid adding new cross-cutting logic to ad hoc files.

## Canonical Milestone Order

Implementation follows the final package, not ad hoc UI redesign plans.

1. Foundation: Tenant, Company, AuthContext, RBAC/ABAC, RLS, Audit Log.
2. Deal Workflow: Customer, Opportunity, Qualification, Discovery, Solution Fit,
   Approval Gate.
3. Quote & Commercial: Product/SKU, Quote, line items, margin calculation,
   Commercial Gate, Proposal Artifact.
4. Delivery, Asset & Renewal: PoC, Delivery, Customer Asset, License,
   Subscription, Renewal, Support/RCA.
5. Controlled AI: AI Drafts, source evidence, AI Quality Gate, Prompt/Model
   Registry, Color Agent review gates.
6. Operations & ROI: Operator console, security console, cost/ROI dashboard,
   runbooks and verification evidence.

## Layering Rules

| Concern | Preferred Location |
| --- | --- |
| Business rules | `packages/business` now, later split to `packages/domain` |
| Use cases and workflow orchestration | `packages/application` or focused `packages/business` modules |
| DB access and migrations | `packages/db`, infrastructure adapters |
| External systems, mail, file, LLM, RAG | `packages/infrastructure`, `packages/proxy-core`, `services/*` |
| API surface | `apps/api/src/routers/*`, `apps/web/src/app/api/*` |
| UI | `apps/web`, `packages/ui` |
| Verification/evidence | `docs/reports`, `docs/evidence`, service-specific evidence folders |

## Safety Rules

- Do not trust `tenantId`, `companyId`, or approver identity from request bodies.
- Calculate quote margin on the server.
- Treat AI output as draft until reviewed and approved.
- Keep export/share/send/delete/deploy operations behind approval gates.
- Do not mutate production DBs, send real mail, deploy, force push, or create
  release tags without explicit final approval.
