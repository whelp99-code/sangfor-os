# Project to Sangfor-os Mapping

Date: 2026-06-26

## Canonical Mapping

| Capability | Canonical Target | Source Projects | Notes |
| --- | --- | --- | --- |
| Portal and role dashboards | `apps/web` | AIOS v1, final package UX, current web app | Preserve role-based flow; AI Workspace is a support panel only |
| API gateway | `apps/api`, `apps/web/src/app/api` | AIOSv2, current web API routes, F-aios-v3 bridge | UI should call canonical APIs rather than source project APIs directly |
| Domain/business rules | `packages/business`, future `packages/domain` | AIOS v1, AIOSv2, final package skeleton | Keep rules server-side |
| Use cases/workflows | `packages/application`, `packages/business` | AIOSv2, F-aios-v3-core, sangfor-mcp-workflow | Split only when it improves boundaries |
| Prisma schema | `packages/db/prisma/schema.prisma` | final package DB skeleton, AIOSv2 DB, finance DB | Canonical operational DB target |
| Auth/RBAC/ABAC | `packages/auth`, API middleware | AIOSv2, final package security docs | Do not trust tenant/company from request body |
| Audit/security | `packages/security`, `packages/business/src/audit-*` | final package, AIOSv2 | Append-only and hash-chain oriented |
| AIOS v1 bridge | `packages/proxy-core`, `scripts/*`, web/API bridge routes | AIOS v1 | Preserve until absorbed feature-by-feature |
| Mail intelligence | `packages/mail-intelligence`, `packages/business/src/mail-*`, web/API routes | AIOS v1, current mail modules | Must feed customer/project/task/approval candidates |
| Quote/commercial | `packages/business/src/quote-engine.ts`, `vendor-request.ts`, finance UI/API | final package, CFO/finance | Margin server-calculated |
| Delivery/asset/renewal | `packages/business/src/asset-renewal.ts`, `poc-center.ts`, UI/API routes | final package, current business modules | Asset lifecycle is required for renewal automation |
| SANGFOR device workflows | `services/sangfor-mcp-workflow`, adapters | sangfor-mcp-workflow | Wrap first; absorb stable domain logic later |
| Engineer automation/RAG | `services/sangfor-engineer-mcp`, infrastructure adapters | sangfor-engineer-mcp | Use service capabilities without copying everything blindly |
| Controlled AI | `packages/business/src/ai-quality-gate.ts`, Color Agent modules, RAG adapters | final package, sangfor services, F-aios-v3 | AI produces drafts/recommendations, not final irreversible actions |
| Voice/JARVIS | `apps/voice` or adapter package | AIOS-JARVIS | Planned after core operating loop |
| Evidence/reporting | `docs/reports`, `docs/evidence` | AIOSv2 evidence model, final package verification | Every major migration decision needs evidence |

## Migration Decision Rules

1. Absorb logic when it is core business behavior and can be typed/tested in the
   monorepo.
2. Wrap services when they have independent runtime value or heavy dependencies.
3. Bridge legacy behavior when parity is needed before full migration.
4. Retire duplicated code only after replacement evidence exists.

## Non-negotiable Alignment Rules

- Final package milestones define order.
- AIOS v1 is a preserved source asset, not accidental legacy trash.
- `sangfor-os` APIs and UI are the user-facing surface.
- Real send/delete/deploy/production mutation actions require approval gates.
