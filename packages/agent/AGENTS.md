<!-- Parent: ../../AGENTS.md -->

# @sangfor/agent — MCP tool-calling agent runtime

> The autonomous execution runtime — an LLM tool-calling loop plus workflow runner. Top of the package dependency graph; only apps consume it.

## Constraints
- Core loop is dependency-injected and side-effect-free — pass deps in; keep it unit-testable (`src/agent.ts` `runAgent`).
- Safety-first: only `SAFE_MCP_TOOLS` (whitelist in `src/adapters.ts`) run automatically; unsafe tools are blocked for human approval unless `allowUnsafe` is explicitly set.
- Wire live MCP tools through `@sangfor/infra` (`runMcpAgent`); do not reach into `apps/*`.

## Dependencies
- Depends on: `@sangfor/business`, `@sangfor/infra`
- Depended on by: `apps/web`

<!-- MANUAL: Notes below this line are preserved on regeneration -->
