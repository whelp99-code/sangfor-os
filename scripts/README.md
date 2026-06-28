# Scripts — bring-up & ops map

`make` (repo root) is the single discoverable entrypoint — run `make help`.
These scripts are not duplicates; they cover different layers. The table below
is the source of truth for "which one do I run".

| Layer | Canonical command | Backing script | What it starts |
|---|---|---|---|
| **MCP / console runtime** | `make up` / `make status` / `make down` | `stack.sh` | bridge 3600, operator console 3502, mock 3400 (containers) + workflow console 3500 (host) |
| **App stack** | `make app` | `start-system.sh` | postgres + redis + api + web (docker compose) |
| **Full integration** | `make integration` | `start-integration-stack.sh` → `start-integration-stack.mjs` | upstream services + AIOSv2 portal, for live verification |
| **External AIOS v1** | `scripts/launch-aios-v1-stack.sh` | — | the separate `AIOS v1` project + standalone mail-intelligence (paths via `AIOS_V1_DIR` / `MAIL_INTELLIGENCE_DIR`) |
| **One-time dev setup** | `scripts/setup-dev.sh` | — | copies `.env`, installs deps, etc. |
| **Health probe** | `make status` | `stack.sh status` / `health-check.sh` | deep check: endpoint 200s + pg/redis/MCP mode |

Notes:
- Prefer `make up` for the MCP runtime; it provisions host deps and waits for
  health. See `docs/plans/reproducibility-and-config-durability-plan.md`.
- Mock stub services (`sangfor-mcp`, `vibe-coding`, `mail-intelligence` in
  `docker-compose.yml`) are behind the `mock` profile — `docker compose
  --profile mock up` — so a plain `up` never starts a misleading green stub.
- `launch-aios-v1-stack.sh` drives a project outside this repo; override its
  locations with `AIOS_V1_DIR` / `MAIL_INTELLIGENCE_DIR` rather than editing paths.
