# Single discoverable entrypoint. MCP/console runtime logic lives in
# scripts/stack.sh; broader stacks delegate to their existing scripts
# (see scripts/README.md for the full map).
.PHONY: help up down status provision logs app integration
.DEFAULT_GOAL := help

help: ## Show this help
	@grep -hE '^[a-z-]+:.*##' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Bring the MCP/console runtime to all-green (3400/3500/3502/3600)
	@bash scripts/stack.sh up

down: ## Stop containers + host workflow console
	@bash scripts/stack.sh down

status: ## Deep health check (real deps, not bare 200)
	@bash scripts/stack.sh status

provision: ## Install host deps for the engineer-mcp workspace
	@bash scripts/stack.sh provision

logs: ## Tail engineer-mcp container logs
	@docker compose logs -f sangfor-engineer-mcp

app: ## Start the app stack: api/web/postgres/redis (scripts/start-system.sh)
	@bash scripts/start-system.sh

integration: ## Start the full integration stack: upstreams + portal (scripts/start-integration-stack.sh)
	@bash scripts/start-integration-stack.sh start
