# Sangfor Agentic Company OS

> 통합 비즈니스 플랫폼(GTM 파이프라인 · CFO/재무 · 메일 인텔리전스 · 도메인 AI · MCP 자동화)을 단일 pnpm/turborepo 모노레포로 운영. SANGFOR Partner OS 청사진을 로컬 TypeScript 스택으로 구현.

This file is the agent entry point — a map, not an encyclopedia. Follow the pointers.

## Architecture
- [ARCHITECTURE.md](ARCHITECTURE.md) — canonical integration direction, milestone order, safety rules.
- **Actual package graph** (source of truth — older docs still list `finance`/`proxy-core`/`application`/`security` packages that no longer exist):

```
apps/       web  (Next.js 16, App Router) — the PRIMARY product backend
            api  (Express 4 REST)         — finance/CFO + webhooks/metrics/MCP edge
packages/   business (domain core, hub) · db (Prisma, ~150 models, formal migrations)
            agent · infra · auth · mail-intelligence · persona · shared · config · health · api-utils
services/   sangfor-engineer-mcp (bridge :3600 · operator :3502 · mock :3400)
            sangfor-mcp-workflow (:3500)
```

Dependency direction (leaf → top): `config · db · shared · api-utils` → `auth · health · infra · mail-intelligence · persona` → `business` → `agent`. Clean DAG; `business` is the hub, `agent` the sink.

## Documentation
- [DEV_REFERENCE.md](docs/DEV_REFERENCE.md) — **living master reference**: system map, workstreams, commands, data-model log, known gotchas. Read first, update after each session.
- [Product blueprint](docs/MANIFEST.md) — numbered `docs/NN_*` package (spec, architecture, security, UX, ops, verification).
- [DESIGN.md](DESIGN.md) — 계기판(dashboard) design system, tokens, UI principles.
- [Code Review](docs/CODE-REVIEW.md) — review standards & checklist.
- Boundary guides: `apps/web`, `apps/api`, `packages/business`, `packages/db`, and each `services/*` carry their own `AGENTS.md`; other packages carry short stubs.

## Domain Guides (existing docs — link, don't duplicate)
- Security / auth: [docs/04_SECURITY/](docs/04_SECURITY/) (Security_Threat_Model, Auth_RBAC_ABAC_RLS, Audit_And_Compliance).
- AI governance: [docs/05_DATA_AI/AI_Quality_Governance.md](docs/05_DATA_AI/AI_Quality_Governance.md).
- Color-agent org (×lens review): [docs/13_COLOR_AGENT_ORG/](docs/13_COLOR_AGENT_ORG/).
- Plans: [docs/plans/](docs/plans/) · [docs/master-plan/](docs/master-plan/) (dev plan, verification, enhancement phases 1–5).

## Quick Rules (critical — every agent must know)
1. **Approval gates for irreversible actions.** Never send real mail, delete, deploy, external-share, mutate a prod DB, force-push, or cut release tags without explicit approval. Route them through `governance/approval-gate`.
2. **Trust nothing from the request body.** Do not trust `tenantId`/`companyId`/approver identity from clients. Calculate quote margin/totals server-side. Multi-tenant + RLS by design.
3. **AI output is a draft** until human-reviewed (human-in-loop learning is the product philosophy). AI drafts must not be treated as approved artifacts.
4. **DB: additive & migration-first.** Schema changes are additive/nullable; formal `pnpm db:migrate:deploy` is the system of record; `db push --accept-data-loss` is banned. Before any schema edit run `git diff origin/main -- packages/db/prisma/schema.prisma`. Access Prisma only via `import { prisma } from "@sangfor/db"` — never `new PrismaClient()`.
5. **Quality gate before merge:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. DB-dependent (integration) tests run under `CI_INTEGRATION=1`.
6. **Concurrent-worktree hazard.** Multiple worktrees share this root and can revert uncommitted edits (thrashing). Commit early to a dedicated branch; see DEV_REFERENCE §8.

## Working Norms (Fable Doctrine)
How every agent thinks, executes, and reports here. Rule numbers (F1–F14) are stable identifiers for cross-file reference.

**Think**
- **F1 Investigate before asking.** If the answer is in files, config, git history, or docs (start with DEV_REFERENCE.md), find it — don't ask. Batch the questions that remain, each with a recommendation and a safe default.
- **F2 Label information state:** confirmed (seen in a file or run output) / inferred / assumed (with basis) / unknown. Never present the unverified as verified.
- **F3 Minimal change.** The smallest change that satisfies the requirement — no drive-by refactors, style sweeps, or new dependencies without cause.
- **F4 Root cause before patch.** A familiar-looking symptom can have a different cause; confirm the evidence supports the fix before applying it.
- **F5 Self-refute before starting.** Name the top 2–3 ways the plan could be wrong and resolve them first.

**Execute**
- **F6 No completion without evidence.** Say "done / fixed / passing" only after actually running verification and seeing it pass — record the command, exit code, and result. The merge gate is Quick Rule 5; "should work" is not done.
- **F7 Never defeat a test to pass it:** no skip, weakened assertions, lowered coverage thresholds, `ts-ignore`/`eslint-disable`, empty catch, or always-green mocks. If an exception is unavoidable, record why and surface it in the report.
- **F8 Follow what exists** — repo patterns, naming, structure, tooling. Use only commands verified to exist (package.json, Makefile, CI config); never guess one.
- **F9 Destructive actions need eyes-on confirmation.** Inspect the target before delete/overwrite/prod change; if reality contradicts the description, stop and report. Irreversible actions additionally pass the approval gate (Quick Rule 1). Never clobber uncommitted changes (Quick Rule 6).
- **F10 Get stuck honestly.** Same error 3 times → change approach. Unresolvable → report BLOCKED with what was tried. Never hide a failure and keep going.

**Report**
- **F11 Conclusion first.** The opening sentence answers "what happened / what was found"; evidence and process follow.
- **F12 Write to be read:** complete sentences — no arrow chains, fragments, or invented shorthand. Readable beats short.
- **F13 Report reality.** Failing tests are reported as failing with output, skipped steps as skipped, unverified areas as unverified.
- **F14 State residual risk.** Completion reports include known limits, unverified areas, and follow-ups.

## Working Here
- pnpm workspace (`apps/*`, `packages/*`); `services/*` are standalone nested workspaces. Node 20 (`.nvmrc`).
- Primary product backend = `apps/web` route handlers (import `@sangfor/business`/`@sangfor/db` directly). `apps/api` owns finance/CFO (web proxies `/api/finance/*` → `:3200/api/cfo`), Outlook webhooks, metrics, MCP bridge.
- Dev ports: web 3101, api 3200, postgres 5434, redis 6380 — full map in [PORT-MAPPING.yaml](PORT-MAPPING.yaml). Start: `pnpm docker:dev && pnpm dev`; MCP stack: `make up`.

<!-- MANUAL: Notes below this line are preserved on regeneration -->
