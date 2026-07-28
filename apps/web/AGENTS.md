<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- Parent: ../../AGENTS.md -->

# @sangfor/web — primary product surface

> Next.js 16 (App Router, React 19) on port 3101 — the **primary product backend**. Route handlers import `@sangfor/business`/`@sangfor/db` directly; the core domain does NOT go through apps/api (finance is the one exception, proxied to :3200).

## Constraints
- **Every mutating route gates access:** call `assertApiAccess(request)` (`src/lib/api-auth.ts`). Sessions are HMAC-SHA256 JWTs verified against `JWT_SECRET`.
- **Fail closed by default:** missing/short `JWT_SECRET` returns `AUTH_CONFIGURATION_UNAVAILABLE`; a fixed mock principal exists only for `AUTH_PROFILE=local_mock` in development/tests. `AUTH_BYPASS_ENABLED=1` applies only to ordinary local/test route guards and never creates an operator context.
- **Operator metadata is server-derived:** MCP/finance operator routes require an authenticated context with `businessRole=system_admin`; caller actor/approver fields cannot grant authority. The only credential-free U002 liveness routes live in the workflow/engineer services; Web exposes no public diagnostic or metadata exception.
- **Next.js 16 has breaking changes** (see the block above) — read `node_modules/next/dist/docs/` before using unfamiliar APIs.
- Finance goes through `src/lib/finance-proxy.ts` → `:3200/api/cfo`; never hit the DB for CFO data here.
- Env via `src/lib/env.ts`; irreversible/approval-gated actions still route through `@sangfor/business` governance.

## Working Here
- Routes under `src/app/`: `(portal)/` (~50 authenticated pages, wrapped in `PortalShell`), `api/` (96 `route.ts` handlers), `cfo/`, `login/`. Client components (`use client`) live in `src/components/`; keep data-fetching in server components/handlers.
- Styling: Tailwind v4 + design tokens in `app/globals.css`, app-local primitives in `components/ui/`. URL state via `nuqs`. Follow [DESIGN.md](../../DESIGN.md).
- Colocated `*.test.ts` (Vitest, `@`→`src`); E2E specs in `tests/e2e/playwright` (`baseURL :3101`).

## Dependencies
- Depends on: `@sangfor/business`, `@sangfor/db`, `@sangfor/agent`, `@sangfor/infra`, `@sangfor/mail-intelligence`, `@sangfor/shared`.
- Depended on by: none (top-level app).

<!-- MANUAL: Notes below this line are preserved on regeneration -->
