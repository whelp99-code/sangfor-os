# Sangfor Agentic Company OS — Architecture

## Unified Monorepo Structure

```
sangfor-os/
├── apps/
│   ├── web/          # Next.js 16 (Business UI + Admin)
│   └── api/          # NestJS + Express hybrid
├── packages/
│   ├── business/     # Core business logic (CRM/PoC/Pipeline/Workflow)
│   ├── finance/      # Finance modules (Invoice/Expense/VAT/Ledger)
│   ├── db/           # Prisma schema (merged, 60+ models)
│   ├── auth/         # JWT/RBAC/API Key/RLS
│   ├── infra/        # Monitoring/SSE/Health/Metrics
│   ├── ui/           # Shared shadcn/ui components
│   └── shared/       # Types, constants, utils
├── docker/           # Caddy, Prometheus, Grafana configs
├── scripts/          # Unified ops scripts
├── docs/             # Sangfor Package V3.2 design documents
├── tests/            # E2E, integration, contract tests
├── docker-compose.yml
├── PORT-MAPPING.yaml
├── HEALTH-REGISTRY.yaml
└── package.json
```

## Source Projects

| Source | Role | Migration |
|--------|------|-----------|
| ai-automation-work-portal | Business Core (66k LOC) | packages/business + apps/web |
| AIOSv2_integration | Infra/Security | packages/auth + packages/infra |
| CFO-AIOS | Finance Engine | packages/finance |
| Sangfor Package V3.2 | Blueprint | docs/ |

## Key Design Principles

1. **Single Prisma Schema** — All models in one place
2. **Server-side Trust** — Margin, approval, RLS all server-enforced
3. **Multi-tenancy via RLS** — PostgreSQL Row Level Security
4. **Append-only Audit** — Hash chain audit log
5. **AI Quality Gate** — Golden Answer Set evaluation
6. **External Services** — Docker-compose managed, not code-coupled
