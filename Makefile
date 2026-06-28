# Single entrypoint for the local MCP/console runtime.
# Real logic lives in scripts/stack.sh (keeps this file tab-trivial).
.PHONY: up down status provision logs

up: ## Bring the whole runtime to all-green (idempotent)
	@bash scripts/stack.sh up

down: ## Stop containers + host workflow console
	@bash scripts/stack.sh down

status: ## Deep health check (real deps, not bare 200)
	@bash scripts/stack.sh status

provision: ## Install host deps for the engineer-mcp workspace
	@bash scripts/stack.sh provision

logs: ## Tail engineer-mcp container logs
	@docker compose logs -f sangfor-engineer-mcp
