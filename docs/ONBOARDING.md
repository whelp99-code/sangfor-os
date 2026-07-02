# Sangfor Agentic Company OS — Onboarding Guide

> Generated from knowledge graph analysis. Last updated: 2026-07-02

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Layers](#architecture-layers)
3. [Key Concepts](#key-concepts)
4. [Guided Tour](#guided-tour)
5. [File Map](#file-map)
6. [Complexity Hotspots](#complexity-hotspots)

---

## Project Overview

**Sangfor Agentic Company OS** is a unified monorepo that powers the Sangfor Partner OS business platform. It consolidates five source projects into one repository.

| Attribute | Details |
|-----------|---------|
| **Languages** | TypeScript, JavaScript, Python, Shell, SQL, CSS, HTML |
| **Frameworks** | Next.js 16, Express, NestJS, Prisma, React, shadcn/ui, Playwright, Vitest, Turborepo |
| **Package Manager** | pnpm (v10.28.1) |
| **Total Files** | 1,377 |
| **Monorepo Tool** | Turborepo (turbo.json) |

**Merged source projects:**
- **ai-automation-work-portal** — Business core (~66k LOC) → `apps/web`, `packages/business`
- **AIOSv2_integration** — Infrastructure, security, monitoring → `packages/auth`, `packages/infra`, Docker
- **CFO-AIOS** — Finance/accounting engine (NestJS) → `packages/finance`
- **Sangfor Package V3.2** — Design blueprints → `docs/`
- **C-Stack** — Service orchestration → `PORT-MAPPING.yaml`, `docker-compose.yml`

### Quick Start

```bash
# Start infrastructure
docker compose up -d postgres redis

# Install and sync database
pnpm install
pnpm db:push

# Start all development servers
pnpm dev

# Open browser at http://localhost:3101
```

### Port Map

| Service | Port |
|---------|------|
| Web (Next.js) | 3101 |
| API (Express) | 3200 |
| Finance (NestJS) | 4100 |
| Sangfor MCP Workflow | 3500 |
| Sangfor Engineer MCP | 3600 |
| Operator Console | 3502 |
| PostgreSQL | 5434 |
| Redis | 6380 |

---

## Architecture Layers

The codebase is organized into 12 architectural layers. These map directly to the monorepo's directory structure.

### 1. Web Application (Next.js 16) — 382 files

The main business UI. Built with Next.js 16 app router, React, and shadcn/ui components. Handles CRM, pipeline management, approvals, deal workspace, and all business-facing interfaces.

- **Entry**: `apps/web/package.json`, `apps/web/next.config.ts`
- **Pattern**: App Router (`src/app/`), component modules (`src/components/`), lib utilities (`src/lib/`)

### 2. MCP Services — 369 files

Two Model Context Protocol (MCP) servers that provide AI agent tool execution:

- **Sangfor Engineer MCP** (`services/sangfor-engineer-mcp/`): 50+ tools, RAG pipeline, Playwright browser automation, knowledge base ingestion, fine-tuning support. This is the primary AI interface.
- **Sangfor Workflow MCP** (`services/sangfor-mcp-workflow/`): AI-driven workflow orchestration, compliance tracking, device management automation, health checking.

Each is a pnpm workspace with multiple sub-packages.

### 3. Business Logic — 163 files

The core business domain at `packages/business/`. Contains:

- CRM operations (deals, opportunities, customers, partners)
- PoC (Proof of Concept) management pipeline
- Workflow and approval engines
- Mail intelligence (email candidate processing)
- Deal qualification and stage progression

This is the largest single package (~66k LOC).

### 4. Documentation — 130 files

Comprehensive docs at `docs/` and within each service. Includes architectural specs, implementation plans, runbooks, verification reports, mockups, and product knowledge bases.

### 5. API Server (Express) — 80 files

Express-based REST API at `apps/api/`. Provides integration endpoints connecting the web frontend to backend services. Includes CFO/finance router modules, search, mail, workflow, and dashboard routes.

- **Entry**: `apps/api/src/index.ts`
- **Pattern**: Routers in `src/routers/`, services in `src/services/`

### 6. Scripts & Automation — 67 files

Operational scripts at `scripts/` for DevOps: health checks, deployment, database management, mock upstream services, knowledge graph ingestion, and end-to-end verification.

### 7. Other (Root Configs) — 66 files

Root-level configuration: `package.json`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, and cross-cutting configs.

### 8. Shared Libraries — 36 files

Shared packages under `packages/`:

| Package | Purpose |
|---------|---------|
| `ui/` | shadcn/ui components (Button, Input, etc.) |
| `shared/` | Types, constants, status enums |
| `api-utils/` | Shared API utilities |
| `config/` | Shared configuration |
| `cache/` | Caching utilities |
| `agent/` | Agent-related types and utilities |
| `application/` | Application-level abstractions |
| `proxy-core/` | Proxy/adapter patterns |
| `persona/` | Persona/user role types |

### 9. Database & Schema — 36 files

Prisma ORM at `packages/db/`. Defines 60+ models across the entire business domain. Includes migrations (22+ migration files), seed data, SQL utilities, and the main `schema.prisma` definition.

### 10. Infrastructure & CI/CD — 24 files

- **Docker**: Dockerfiles for each service, `docker-compose.yml`, Caddy reverse proxy
- **CI/CD**: GitHub Actions workflows (`ci.yml`, `cd.yml`, `docker.yml`, `stack-smoke.yml`)
- **Monitoring**: Prometheus (`:9090`) and Grafana (`:3000`) configurations
- **Package**: `packages/infra/` provides monitoring/SSE/metrics infrastructure

### 11. Auth & Security — 16 files

Two packages:

- `packages/auth/`: JWT authentication, RBAC authorization, API key management
- `packages/security/`: Security enforcement and guards

### 12. Agent & AI Tools — 8 files

AI agent workspace files under `.omo/` and `.superpowers/`: plans for automation, UX redesign, integration, and spec-gap closure.

---

## Key Concepts

### Monorepo with pnpm Workspaces

The entire codebase is a single pnpm workspace managed by Turborepo. This means:

- `pnpm -r <command>` runs across all packages
- `pnpm --filter <package>` targets a specific package
- Dependencies are hoisted to the root `node_modules/`
- **Key scripts**: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm db:push`

### Model Context Protocol (MCP)

The two MCP services (`sangfor-engineer-mcp` and `sangfor-mcp-workflow`) implement Anthropic's Model Context Protocol — they expose tools that AI agents (Claude, Codex, etc.) can discover and call. `sangfor-engineer-mcp` is the more mature service with 50+ tools across RAG, browser automation, product knowledge, and approval workflows.

### Prisma ORM with 60+ Models

The database layer uses Prisma with a unified schema (`packages/db/prisma/schema.prisma`). The schema spans business CRM, finance (invoices, expenses, VAT), authentication, mail intelligence, and AI agent state. Key models include:

- Deals, opportunities, customers, partners, contacts
- Invoices, tax invoices, expenses, ledgers
- Mail candidates, context packs, engagement records
- Approval chains, audit logs, skill catalogs

### Integration Architecture

The web frontend (Next.js 16, port 3101) communicates with the Express API (port 3200). The API routes into:

- Business packages (CRM, workflows)
- Finance services (invoices, expenses, VAT)
- Search, mail, and workflow engines

MCP services operate independently and connect to AI agent runtimes.

### Testing Stack

- **Unit tests**: Vitest (found in each package's `vitest.config.ts`)
- **E2E tests**: Playwright (config at `playwright.config.ts`, specs in `tests/e2e/playwright/`)
- **Test conventions**: Test files are colocated (`*.test.ts`, `*.spec.ts`) or in `tests/` directories

---

## Guided Tour

The following 12 steps are the recommended learning path for new team members.

| Step | Title | Key Files |
|------|-------|-----------|
| 1 | **Project Overview** | `README.md`, `ARCHITECTURE.md` |
| 2 | **Monorepo Structure & Build System** | `package.json`, `turbo.json`, `tsconfig.base.json` |
| 3 | **Web Application (Next.js 16)** | `apps/web/package.json` |
| 4 | **API Server (Express)** | `apps/api/package.json`, `apps/api/src/index.ts` |
| 5 | **Core Business Logic** | `packages/business/package.json`, `packages/business/src/index.ts` |
| 6 | **Database Layer (Prisma)** | `packages/db/package.json`, `packages/db/prisma/schema.prisma` |
| 7 | **Authentication & Security** | `packages/auth/package.json`, `packages/security/package.json` |
| 8 | **MCP Services (AI Integration)** | `services/sangfor-engineer-mcp/`, `services/sangfor-mcp-workflow/` |
| 9 | **Infrastructure & Deployment** | Dockerfiles, `.github/workflows/`, Grafana/Prometheus configs |
| 10 | **Database Schema Details** | `packages/db/prisma/schema.prisma`, migration files |
| 11 | **Shared Libraries & UI Components** | `packages/ui/`, `packages/shared/`, `packages/shared/src/status.ts` |
| 12 | **Testing & Quality** | `playwright.config.ts`, test files across all packages |

### Step-by-Step Walkthrough

1. **Start with the README and ARCHITECTURE** — understand the project's purpose, the five merged source projects, and the high-level architecture.

2. **Review the monorepo config** — root `package.json` for workspace scripts, `turbo.json` for the build pipeline, `tsconfig.base.json` for shared TypeScript settings.

3. **Explore the web app** — Next.js 16 with App Router. Key directories: `src/app/` (pages/routes), `src/components/` (React components), `src/lib/` (utilities/hooks).

4. **Understand the API server** — Express entry point at `apps/api/src/index.ts`. Routes are organized by domain (`routers/cfo/`, `routers/business`, etc.).

5. **Dive into business logic** — `packages/business/src/` contains the core domain with service modules, approval workflows, deal pipeline, and mail intelligence.

6. **Study the database schema** — `packages/db/prisma/schema.prisma` defines all 60+ models. Follow the migration history to understand schema evolution.

7. **Review auth and security** — `packages/auth/src/` handles JWT tokens and RBAC. `packages/security/` enforces access controls.

8. **Explore the MCP services** — The two MCP services are the AI integration layer. Start with `sangfor-engineer-mcp` (more mature, 50+ tools).

9. **Check infrastructure** — Docker compose files define the full stack. GitHub Actions workflows handle CI/CD. Monitoring via Prometheus/Grafana.

10. **Review the schema in detail** — Beyond the main Prisma schema, each MCP service has its own schema for agent state and knowledge storage.

11. **Understand shared components** — `packages/ui/` has reusable shadcn/ui components. `packages/shared/` has common types and constants.

12. **Run the tests** — Vitest for unit tests, Playwright for E2E. Test patterns are documented in `playwright.config.ts`.

---

## File Map

### Root Configuration

| File | Purpose |
|------|---------|
| `package.json` | Root monorepo config, workspace scripts, dependencies (Prisma, Zod, Playwright) |
| `turbo.json` | Turborepo pipeline configuration |
| `tsconfig.base.json` | Shared TypeScript configuration for all packages |
| `docker-compose.yml` | Main Docker stack definition (PostgreSQL, Redis) |
| `eslint.config.mjs` | Root ESLint configuration |
| `playwright.config.ts` | E2E test runner configuration |
| `pnpm-workspace.yaml` | pnpm workspace definitions |

### Web Application (`apps/web/`)

| File | Purpose |
|------|---------|
| `next.config.ts` | Next.js 16 configuration |
| `sentry.client.config.ts` | Sentry error tracking (client) |
| `sentry.server.config.ts` | Sentry error tracking (server) |
| `src/app/globals.css` | Global styles |
| `src/app/(portal)/approvals/[id]/page.tsx` | Approval detail page (complex) |
| `src/app/cfo/(cfo)/tax-invoices/page.tsx` | Tax invoice list page (complex) |
| `src/components/ui/sidebar.tsx` | Navigation sidebar (24 exports) |
| `src/components/ai-workspace/index.ts` | AI workspace component |
| `postcss.config.mjs` | PostCSS configuration |

### API Server (`apps/api/`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Express server entry point |
| `src/routers/business.router.ts` | Business domain routes |
| `src/routers/cfo/index.ts` | CFO/finance routes hub |
| `src/routers/cfo/invoices.router.ts` | Invoice API endpoints |
| `src/routers/cfo/expenses.router.ts` | Expense API endpoints |
| `src/routers/cfo/vat.router.ts` | VAT API endpoints |
| `src/routers/mail.router.ts` | Mail processing routes |
| `src/routers/workflow.router.ts` | Workflow routes |
| `src/routers/search.router.ts` | Search API routes |

### Business Logic (`packages/business/`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Business package entry point (10 exports) |
| `src/mail-candidates.ts` | Mail candidate processing (67 functions, complex) |
| `src/phase14/index.ts` | Phase 14 context pack logic |
| `src/skills/index.ts` | Skill catalog management |
| `src/skills/types.ts` | Skill type definitions |
| `src/deal-qualification.test.ts` | Deal qualification tests |
| `src/engagement-conversion.test.ts` | Engagement conversion tests |

### Database (`packages/db/`)

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Main Prisma schema (60+ models, complex) |
| `prisma/migrations/` | 22+ migration files covering schema evolution |
| `src/index.ts` | Database access layer (2 exports) |
| `prisma/sql/domain_axis_embedding.sql` | Domain axis embedding queries |
| `prisma/sql/domain_axis_tables.sql` | Domain axis table definitions |

### Auth & Security (`packages/auth/`, `packages/security/`)

| File | Purpose |
|------|---------|
| `packages/auth/src/index.ts` | Auth package (JWT, RBAC, API keys) |
| `packages/auth/src/types.ts` | Auth type definitions |
| `packages/security/src/index.ts` | Security enforcement |

### Infrastructure (`packages/infra/`, Docker)

| File | Purpose |
|------|---------|
| `packages/infra/src/index.ts` | Infrastructure utilities (35 exports) |
| `.github/workflows/ci.yml` | CI pipeline |
| `.github/workflows/cd.yml` | CD pipeline |
| `.github/workflows/docker.yml` | Docker build workflow |
| `docker/docker-compose.c-stack.yml` | C-Stack Docker compose |
| `docker/caddy/Caddyfile` | Caddy reverse proxy config |
| `docker/prometheus/prometheus.yml` | Prometheus monitoring config |
| `docker/grafana/datasources/datasource.yml` | Grafana datasource config |

### MCP Services

**Sangfor Engineer MCP** (`services/sangfor-engineer-mcp/`):

| File/Module | Purpose |
|-------------|---------|
| `apps/mcp-server/src/index.ts` | MCP server entry point |
| `packages/sangfor-rag/` | RAG pipeline (embeddings, retrieval) |
| `packages/sangfor-knowledge/` | Knowledge base management |
| `packages/sangfor-chrome/` | Playwright browser automation |
| `packages/sangfor-collector/` | Data collection tools |
| `packages/sangfor-approval/` | Approval workflow tools |
| `packages/sangfor-planner/` | AI planning tools |
| `packages/sangfor-evidence/` | Evidence collection |
| `packages/sangfor-verifier/` | Verification tools |
| `packages/sangfor-finetune/` | Fine-tuning support |
| `packages/sangfor-pptx/` | PowerPoint generation |
| `packages/sangfor-wiki/` | Wiki integration |
| `packages/sangfor-product-adapters/` | Product-specific adapters |
| `packages/sangfor-operator/` | Operator console tools |
| `packages/sangfor-feedback/` | Feedback collection |
| `packages/sangfor-evals/` | Evaluation tools |
| `packages/sangfor-screenshot/` | Screenshot capture |
| `data/sources/` | KB source data (site maps, product tables) |
| `prisma/schema.prisma` | MCP-specific database schema |

**Sangfor Workflow MCP** (`services/sangfor-mcp-workflow/`):

| File/Module | Purpose |
|-------------|---------|
| `apps/mcp-server/` | MCP server |
| `apps/operator-console/` | Operator web console |
| `packages/workflow-core/` | Core workflow engine |
| `packages/workflow-engine/` | Device and operation models |
| `packages/health-checker/` | Health checking utilities |
| `packages/wiki-sync/` | Wiki synchronization |
| `data/compliance/` | Compliance records |
| `data/vendors/` | Vendor database |

### Shared Libraries

| Package | Files | Purpose |
|---------|-------|---------|
| `packages/ui/` | `Button.tsx`, `Input.tsx`, `index.ts` | Shared shadcn/ui React components |
| `packages/shared/` | `status.ts` | Common types, constants, status enums |
| `packages/api-utils/` | `index.ts` | Shared API utility functions |
| `packages/agent/` | `types.ts` | Agent type definitions |
| `packages/cache/` | `index.ts` | Caching utilities |
| `packages/config/` | `index.ts` | Configuration management |
| `packages/application/` | `index.ts` | Application-level abstractions |
| `packages/proxy-core/` | `index.ts`, `types.ts` | Proxy/adapter base patterns |
| `packages/health/` | `index.ts` | Health check utilities |
| `packages/mail-intelligence/` | `index.ts` | Mail intelligence pipeline |
| `packages/persona/` | (types) | User persona definitions |

### Key Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `health-check.sh` | Check all services health |
| `mock-upstreams.mjs` | Start mock external services |
| `start-system.sh` | Start full system stack |
| `deploy-production.sh` | Production deployment |
| `daily-report.sh` | Daily report generation |
| `run-all-checks.sh` | Run all verification checks |
| `reset-db.sh` | Reset database |
| `seed-db.sh` | Seed database with test data |
| `ingest-mail-intelligence-to-knowledge.mjs` | Mail intelligence ingestion (complex) |
| `verify-portal-all-pages-functional.mjs` | Portal page verification (complex) |

---

## Complexity Hotspots

These areas are the most complex and should be approached with care. Listed roughly by size/impact.

### 🔴 Critical Complexity

| File | Package | Reason |
|------|---------|--------|
| `packages/business/src/mail-candidates.ts` | Business Logic | 67 functions, 13 exports — the largest single business module |
| `packages/business/src/phase14/index.ts` | Business Logic | Phase 14 context pack logic |
| `packages/business/src/skills/` | Business Logic | Skill catalog management |
| `packages/db/prisma/schema.prisma` | Database | 60+ models, complex relationships |
| `packages/db/prisma/migrations/` | Database | 22+ migration files |

### 🟡 High Complexity

| File | Package | Reason |
|------|---------|--------|
| `apps/web/src/components/ui/sidebar.tsx` | Web App | 24 exports, navigation logic |
| `apps/web/src/app/(portal)/approvals/[id]/page.tsx` | Web App | Complex approval UI with workflow |
| `apps/web/src/app/cfo/(cfo)/tax-invoices/page.tsx` | Web App | Tax invoice management UI |
| `services/sangfor-engineer-mcp/packages/sangfor-rag/` | MCP | Full RAG pipeline (embeddings, retrieval) |
| `services/sangfor-engineer-mcp/packages/sangfor-knowledge/` | MCP | Knowledge base management |
| `services/sangfor-mcp-workflow/packages/workflow-engine/` | MCP | Device and operation models |
| `packages/infra/src/index.ts` | Infrastructure | 35 exports — monitoring, SSE, metrics |
| `packages/agent/src/index.ts` | Shared | 31 exports — agent type system |
| `docs/superpowers/plans/` | Documentation | Implementation plans with detailed specs |

### 🟢 Moderate (Still Important)

| File | Package | Reason |
|------|---------|--------|
| `apps/api/src/index.ts` | API Server | Express server entry, middleware chain |
| `apps/api/src/routers/cfo/` | API Server | 15+ CFO router modules |
| `packages/business/src/index.ts` | Business Logic | 10 exports, business service orchestration |
| `packages/shared/src/status.ts` | Shared | Status enums used across all packages |
| `packages/auth/src/index.ts` | Auth | JWT/RBAC implementation |
| `docker-compose.yml` | Infrastructure | Full service orchestration definition |
| `playwright.config.ts` | Testing | E2E test configuration |

### Tips for New Developers

1. **Start with a single layer** — Web or API are good entry points. The tour section above guides you step by step.
2. **Use `pnpm --filter` to target** — E.g., `pnpm --filter @sangfor/web dev` to run just the web app.
3. **Read the Prisma schema first** — Understanding the data model (`packages/db/prisma/schema.prisma`) makes everything else click.
4. **The MCP services are standalone** — `services/sangfor-engineer-mcp/` can be developed independently of the web app.
5. **Tests are colocated** — Every package has tests next to its source. Run `pnpm test` from any package.
6. **Check `ARCHITECTURE.md` and `docs/`** for detailed design decisions and specifications.

---

*Generated by `/understand-onboard` from the knowledge graph at commit `3312d2b`.*
