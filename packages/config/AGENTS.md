<!-- Parent: ../../AGENTS.md -->

# @sangfor/config — env/secrets validation + port registry

> Single source of truth for env/secrets validation (zod) and the service `PORT_REGISTRY`. A Tier-0 leaf.

## Constraints
- Secrets are mandatory by policy (no silent `.optional()`); validate via the zod schema.
- Mask secrets on log (`maskSecrets`); never echo raw secret values.
- Import narrowly via the `ports`/`schema` subpath exports (see the `exports` map).

## Dependencies
- Depends on: none
- Depended on by: `@sangfor/auth`, `@sangfor/health`, `@sangfor/infra`

<!-- MANUAL: Notes below this line are preserved on regeneration -->
