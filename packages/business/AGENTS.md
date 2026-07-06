<!-- Parent: ../../AGENTS.md -->

# @sangfor/business — domain core

> The application brain: CRM, finance, mail, governance, orchestration, domain-AI, and skills. The largest package and the architectural hub — every data/mail concern funnels through here up to `@sangfor/agent`.

## Constraints
- **Prisma only via the shared singleton:** `import { prisma } from "@sangfor/db"`. Never `new PrismaClient()`.
- **Layer position:** may depend on `@sangfor/shared`, `@sangfor/db`, `@sangfor/mail-intelligence` ONLY. Do not import `@sangfor/agent`/`@sangfor/infra` (they sit above you) or `apps/*`.
- **Approval-gated actions** (send/delete/deploy/export) go through `governance/approval-gate`; **AI output is draft** until reviewed (`governance/ai-decision*`, `domain-ai/`).
- **Server-authoritative money:** quote margin/totals are computed here, never trusted from input.
- Validate inputs with `zod`. Keep the core-loop/runtime dependency-injected (deps passed in) so it stays unit-testable.

## Working Here
- Each `src/<area>/` has its own barrel `index.ts`; the root `src/index.ts` re-exports all. Add new modules to the area barrel, and add a `package.json` subpath export only for deep-import entry points (see the `exports` map in `package.json`).
- Areas: `crm/`, `finance/`, `governance/`, `mail/` (+`mail/outlook/`), `domain-ai/`, `orchestration/`, `skills/`, `phase14/`, `platform/llm/`, plus top-level modules (command-center, improvement-loop, engagement-center, dev-engine, …).
- Colocate `*.test.ts` next to source; golden tests use `__snapshots__`/`__fixtures__`. DB-touching tests gate on `CI_INTEGRATION=1`.
- LLM config resolves db → env → default via `src/platform/llm/config.ts`; hydrate before AI calls (see DEV_REFERENCE §3.E).

## Dependencies
- Depends on: `@sangfor/shared`, `@sangfor/db`, `@sangfor/mail-intelligence`.
- Depended on by: `apps/web` (66 route handlers), `apps/api`, `@sangfor/agent`.

<!-- MANUAL: Notes below this line are preserved on regeneration -->
