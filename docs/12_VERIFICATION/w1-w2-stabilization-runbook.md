# W1-W2 Stabilization Runbook

## Purpose

Verify the W1-W2 stabilization baseline for `sangfor-os`: mode matrix, mail loop, commercial gate baseline, role workspaces, health checks, and deterministic demo seed.

## Start local dependencies

```bash
pnpm docker:dev
pnpm db:push
pnpm db:seed
pnpm dev:web
```

## Required verification commands

```bash
pnpm --dir packages/shared exec vitest run src/modes.test.ts
pnpm --dir packages/business exec vitest run src/stabilization-readiness.test.ts src/commercial-approval.test.ts src/mail-candidates.test.ts src/mail-candidate-connections.test.ts
CI_INTEGRATION=1 pnpm --dir packages/business exec vitest run src/phase12-mail-candidate-connection.test.ts
pnpm typecheck
pnpm test
pnpm build
```

## Health check

```bash
WEB_URL=http://localhost:3101 API_URL=http://localhost:3200 FINANCE_URL=http://localhost:4100 bash scripts/health-check.sh
```

Critical checks must pass. Optional service checks may report skipped/unavailable when the service is not running.

## Role workspace smoke

```bash
curl -s http://localhost:3101/operator | grep "Operator workspace"
curl -s http://localhost:3101/security | grep "Security workspace"
```

## Real-mail smoke

Use the dedicated runbook:

```text
docs/12_VERIFICATION/real-mail-hardening-runbook.md
```

Never copy private mail contents into committed files.
