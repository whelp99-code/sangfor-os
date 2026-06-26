# Final Package Gap Matrix

Date: 2026-06-26

## Status Legend

| Status | Meaning |
| --- | --- |
| Complete | Current repo has implementation and verification evidence |
| Partial | Current repo has relevant implementation but missing coverage or proof |
| Missing | No clear implementation found in the current canonical surface |
| Misaligned | Implementation exists but conflicts with final package direction |

## Must Have Coverage

| ID | Requirement | Current Repo Evidence | Status | Next Action |
| --- | --- | --- | --- | --- |
| M1 | Domain-Agnostic Core | `packages/business`, `packages/application`, workflow modules | Partial | Clarify domain/application boundaries and source ownership |
| M2 | Industry Pack | `docs/10_CODE_SKELETON/seed/*`, SANGFOR docs under `docs/03_BUSINESS`, `docs/13_COLOR_AGENT_ORG` | Partial | Add install/seed path and runtime registry proof |
| M3 | Multi-tenant Ready | Prisma schema, `AuthContext`, API context fields `tenantId`/`companyId`, tRPC protected input scope guard | Partial | Extend scoped repository behavior beyond initial business routes and Next API routes |
| M4 | AuthContext | `packages/auth/src/auth-context.ts`, `apps/api/src/context*`, `apps/api/src/middleware/auth.ts`, `apps/api/src/routers/trpc.ts` | Partial | Continue migrating all APIs to derive tenant/company/user from server context |
| M5 | RBAC + ABAC | `packages/auth/src/rbac.ts`, `AuthContext.permissions`, web permission tests | Partial | Map final package personas to business roles and ABAC assignments |
| M6 | PostgreSQL RLS | `packages/db/src/rls.ts`, `packages/db/src/rls.test.ts`, `docs/10_CODE_SKELETON/db/rls.sql` | Partial | Convert the tested baseline to an approved migration and extend indirect scoped tables |
| M7 | Approval Gate | `packages/business/src/approval-gate.ts`, `approval-db.ts`, approval UI | Partial | Confirm state machine and high-risk action gates |
| M8 | Audit Integrity | `packages/business/src/audit-chain.ts`, `packages/business/src/audit-db.ts`, `packages/business/tests/unit/audit-*.test.ts`; direct `auditLog.create` writes centralized through writer | Partial | Add DB constraints/migration and broaden hashed audit coverage across high-risk workflow events |
| M9 | Artifact Versioning | Proposal/knowledge/artifact related modules and docs | Partial | Prove AI Draft vs Approved Artifact separation |
| M10 | Deal Workflow | Customer/opportunity/task modules and UI routes | Partial | Close Customer -> Opportunity -> Qualification -> Approval scenario |
| M11 | Quote Engine | `packages/business/src/quote-engine.ts`, finance/proposal UI | Partial | Verify server-side margin and Commercial Gate behavior |
| M12 | Customer Asset Lifecycle | `packages/business/src/asset-renewal.ts`, PoC/support routes | Partial | Verify Acceptance -> Asset -> License -> Subscription -> Renewal |
| M13 | AI Quality Gate | `packages/business/src/ai-quality-gate.ts`, AI docs | Partial | Link AI draft quality checks to approval/evidence UI |
| M14 | Role-based Dashboard | `apps/web/src/app/(portal)/*`, role dashboard components | Misaligned | Realign current AI Workspace changes to role-based dashboard requirements |
| M15 | Operational Runbook | `docs/07_OPERATIONS/*`, health scripts | Partial | Add runtime verification evidence and operator/security surfaces |

## V3.1/V3.2 Patch Coverage

| Requirement | Current Repo Evidence | Status | Next Action |
| --- | --- | --- | --- |
| Vendor Request Operations | `packages/business/src/vendor-request.ts`, final package skeleton docs | Partial | Connect to Opportunity/Quote approval flow |
| Asset & License Lifecycle | `packages/business/src/asset-renewal.ts`, Prisma models/migrations | Partial | Verify lifecycle scenario and UI/API coverage |
| Certification Matrix | final package docs and skeleton | Missing | Locate or implement canonical TypeScript model/API |
| Data Export Governance | final package docs and skeleton | Partial | Gate copy/download/export/share/print and audit all events |
| AI Golden Answer Evaluation | `packages/business/src/ai-quality-gate.ts`, docs | Partial | Verify prompt/model registry and evaluation workflow |
| Color Agent Organization | `packages/business/src/color-agent.ts`, web Color Agent UI, final package V3.2 docs | Partial | Ensure routing, handoff, and review gates match V3.2 package |

## Immediate Priority

1. Continue Foundation gap closure by migrating remaining audit writes and API scope checks.
2. Build one end-to-end operating loop: Mail -> Customer/Project candidate ->
   Approval -> Quote/Artifact draft -> Evidence.
3. Run AIOS v1 bridge read-only smoke and create parity checklist.
