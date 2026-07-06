<!-- Parent: ../../AGENTS.md -->

# @sangfor/infra — observability + integration + resilience toolkit

> Cross-cutting runtime plumbing — metrics, structured logging, tracing, resilience (retry/circuit-breaker), the MCP client, integration-target probing, and the engineer-console RAG/knowledge bridge.

## Constraints
- Named-export barrel (not wildcard) — export deliberately.
- Use `withRetry`/`CircuitBreaker` for external calls; `HttpStatusError` for status failures.
- MCP access goes through `src/mcp-client.ts` (`listMcpTools`/`callMcpTool`).

## Dependencies
- Depends on: `@sangfor/config`
- Depended on by: `@sangfor/agent`, `apps/web`, `apps/api`

<!-- MANUAL: Notes below this line are preserved on regeneration -->
