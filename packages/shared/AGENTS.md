<!-- Parent: ../../AGENTS.md -->

# @sangfor/shared — framework-agnostic shared types & vocab

> Shared types, status/mode vocabularies (`ROLE_MODES`, `GTM_PIPELINE`, `ApprovalState`), format/sanitize helpers, and OpenTelemetry tracing setup. A Tier-0 leaf.

## Constraints
- Framework-agnostic — no React, no Prisma, no app imports.
- Const-tuple + derived-union pattern (`as const` → `(typeof X)[number]`); barrel re-exports `.js`.
- Import narrowly via the `tracing`/`modes`/`types` subpath exports (see the `exports` map).

## Dependencies
- Depends on: none
- Depended on by: `@sangfor/business`, `@sangfor/persona`, `apps/web`, `apps/api`

<!-- MANUAL: Notes below this line are preserved on regeneration -->
