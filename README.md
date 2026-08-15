# Sangfor Agentic Company OS

**단일 통합 레포지토리** — BLRO OS 비즈니스 플랫폼의 모든 코드를 한 곳에서 관리합니다.

## 통합 출처

| 원본 프로젝트 | 역할 | 통합 위치 |
|--------------|------|-----------|
| ai-automation-work-portal | 비즈니스 코어 (66k LOC) | `apps/web`, `packages/business` |
| AIOSv2_integration | 인프라/보안/모니터링 | `packages/auth`, `packages/infra`, Docker |
| CFO-AIOS | 재무/회계 엔진 | `apps/api` (`/api/cfo`) · `packages/business/src/finance` |
| Sangfor Package V3.2 | 설계 청사진 | `docs/` |
| C-Stack | 서비스 오케스트레이션 | `PORT-MAPPING.yaml`, `docker-compose.yml` |

## Architecture

```
apps/
├── web/          Next.js 16 — primary product backend (Business UI + API routes)
├── api/          Express + tRPC — finance/CFO + webhooks/metrics/MCP edge
packages/
├── business/     domain core: CRM/PoC/pipeline/mail/finance/governance/domain-AI
├── db/           Prisma schema (~150 models) + RLS
├── agent/        MCP tool-calling agent runtime
├── infra/        metrics/logging/tracing/resilience/MCP client
├── auth/         Graph OAuth, RBAC, API keys
├── mail-intelligence/  read-only mail contract + repository
├── shared/       types, status/mode vocab, tracing
├── ui/           shared React component library
└── config·health·persona·api-utils   env/ports · health · classify seam · webhook seam
```

## Quick Start

```bash
# 1. Start infrastructure
docker compose up -d postgres redis

# 2. Install & migrate
pnpm install
pnpm db:push

# 3. Start development
pnpm dev

# 4. Open browser
open http://localhost:3101
```

## Port Map

| Service | Port | URL |
|---------|------|-----|
| Web (Next.js) | 3101 | http://localhost:3101 |
| API (Express) | 3200 | http://localhost:3200 |
| Sangfor MCP Workflow | 3500 | http://localhost:3500 |
| Sangfor Engineer MCP | 3600 | http://localhost:3600 |
| Sangfor Operator Console | 3502 | http://localhost:3502 |
| Sangfor Mock Console | 3400 | http://localhost:3400 |
| PostgreSQL | 5434 | localhost:5434 |
| Redis | 6380 | localhost:6380 |
| Prometheus | 9090 | http://localhost:9090 |
| Grafana | 3000 | http://localhost:3000 |

## Services Structure

```
services/
├── sangfor-engineer-mcp/     # Core MCP server (50+ tools, RAG, Playwright)
└── sangfor-mcp-workflow/     # Workflow orchestrator (AI-driven, compliance, device mgmt)
```

## Key Scripts

```bash
pnpm dev              # Start all dev servers
pnpm test             # Run all tests
pnpm build            # Production build
pnpm db:push          # Sync Prisma schema
pnpm health:check     # Check all services
pnpm mock:upstreams   # Start mock external services
pnpm docker:up        # Full Docker stack
```
