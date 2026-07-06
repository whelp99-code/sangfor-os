<!-- Parent: ../../AGENTS.md -->

# @sangfor/health — health-check registry

> Small compiled utility — a registry for service liveness/readiness probes (`src/registry.ts`).

## Constraints
- Keep it tiny and dependency-light; it is a shared probe utility, not a service.
- Compiled to `dist`.

## Dependencies
- Depends on: `@sangfor/config`
- Depended on by: health-check surfaces across apps/services

<!-- MANUAL: Notes below this line are preserved on regeneration -->
