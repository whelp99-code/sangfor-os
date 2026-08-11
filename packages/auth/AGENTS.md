<!-- Parent: ../../AGENTS.md -->

# @sangfor/auth — authentication & authorization

> Microsoft Graph OAuth, token management, RBAC, API keys, and auth context. A compiled package (built to `dist`).

## Constraints
- Security-sensitive — never log or return raw tokens/secrets; secrets come validated from `@sangfor/config`.
- Compiled: consumers import from `dist`; run the build before dependents typecheck.
- Colocated `*.test.ts`; export types with `export type`.

## Dependencies
- Depends on: `@sangfor/config`
- Depended on by: `apps/api`, `apps/web` (which also keeps its own session layer under `apps/web/src/lib/auth`)

<!-- MANUAL: Notes below this line are preserved on regeneration -->
