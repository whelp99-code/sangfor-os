# Sangfor Agentic Company OS

**단일 통합 레포지토리** — Sangfor Partner OS 비즈니스 플랫폼의 모든 코드를 한 곳에서 관리합니다.

## 통합 출처

| 원본 프로젝트 | 역할 | 통합 위치 |
|--------------|------|-----------|
| ai-automation-work-portal | 비즈니스 코어 (66k LOC) | `apps/web`, `packages/business` |
| AIOSv2_integration | 인프라/보안/모니터링 | `packages/auth`, `packages/infra`, Docker |
| CFO-AIOS | 재무/회계 엔진 (NestJS) | `packages/finance` |
| Sangfor Package V3.2 | 설계 청사진 | `docs/` |
| C-Stack | 서비스 오케스트레이션 | `PORT-MAPPING.yaml`, `docker-compose.yml` |

## Architecture

```
apps/
├── web/          Next.js 16 (Business UI)
├── api/          Express API (Integration)
packages/
├── business/     CRM/PoC/Pipeline/Workflow/Approval (66k LOC)
├── finance/      Invoice/Expense/VAT/Ledger (NestJS)
├── db/           Prisma Schema (60+ models, merged)
├── auth/         JWT/RBAC/API Key
├── infra/        Monitoring/SSE/Metrics
├── ui/           Shared shadcn/ui components
├── shared/       Types, constants
└── mail-intelligence/  Email pipeline
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
| Finance (NestJS) | 4100 | http://localhost:4100 |
| PostgreSQL | 5434 | localhost:5434 |
| Redis | 6380 | localhost:6380 |
| Prometheus | 9090 | http://localhost:9090 |
| Grafana | 3000 | http://localhost:3000 |

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
