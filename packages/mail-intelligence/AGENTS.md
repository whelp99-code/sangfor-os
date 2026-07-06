<!-- Parent: ../../AGENTS.md -->

# @sangfor/mail-intelligence — read-only mail contract + repository

> Reads mail from the DB for portal rehearsal (Track M). Send/delete/move are INTENTIONALLY not implemented.

## Constraints
- Read-only by design — never add send/delete/move here (OAuth/sync lives in `@sangfor/business` `mail/outlook`).
- Split: pure types in `src/contract.ts`, DB reads in `src/repository.ts`.

## Dependencies
- Depends on: `@sangfor/db`
- Depended on by: `@sangfor/business`, `apps/web`

<!-- MANUAL: Notes below this line are preserved on regeneration -->
