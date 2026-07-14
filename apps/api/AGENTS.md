<!-- Parent: ../../AGENTS.md -->

# @sangfor/api — finance/CFO + integration edge

> Express 4 REST backend on port 3200. NOT the primary product API (that is `apps/web` route handlers). This service authoritatively owns the **CFO/finance domain** plus Outlook webhooks, Prometheus metrics, SSE events, and the MCP-bridge proxy.

## Constraints
- **Finance is the source of truth here.** `apps/web` reaches finance only by proxying `/api/finance/*` → `:3200/api/cfo` with `FINANCE_API_KEY`. Do not duplicate CFO logic in web.
- **Guard every finance route.** REST `/api/cfo/*` (beyond public health) requires `apiKeyMiddleware` + `financeAccessGuard` (system_admin/finance_manager/ceo). Effective order: global rate limiter → public CFO health exception → API key → finance access → CFO router → error handler.
- Outlook webhooks validate `clientState` and classify via `@sangfor/persona`. HomeTax secure-mail decryption lives in `src/services/finance/hometax-securemail/` (vendored crypto) — the company 사업자번호 key comes from `CompanySettings`, never hard-coded.
- Money math is server-side; treat all external input as untrusted.

## Working Here
- REST routes live in `src/routes/`: `cfo.ts` owns the CFO surface and `events.ts` owns SSE. `createApp()` in `src/index.ts` wires everything.
- Colocated `*.test.ts`; DB-dependent tests gate on `CI_INTEGRATION=1` and run serially (shared DB — see `vitest.config.ts`).

## Dependencies
- Depends on: `@sangfor/business`, `@sangfor/db`, `@sangfor/auth`, `@sangfor/infra`, `@sangfor/persona`, `@sangfor/shared`, `@sangfor/api-utils`.
- Depended on by: `apps/web` (finance proxy only).

<!-- MANUAL: Notes below this line are preserved on regeneration -->
