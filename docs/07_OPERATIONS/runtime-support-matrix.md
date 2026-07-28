# Runtime support matrix (U003)

Three independent pnpm workspaces pin Node, pnpm, lockfile, and ports so any checkout of the release baseline can be reproduced without guessing.

## Workspaces

| Workspace | Path | Node (`.nvmrc` / `engines.node`) | packageManager | Lockfile |
|-----------|------|-----------------------------------|----------------|----------|
| **root** | `.` (`sangfor-agentic-os`) | `20` / `>=20 <21` | `pnpm@10.28.1` | `pnpm-lock.yaml` |
| **engineer** | `services/sangfor-engineer-mcp` | `20` / `>=20 <21` | `pnpm@10.28.1` | `services/sangfor-engineer-mcp/pnpm-lock.yaml` |
| **workflow** | `services/sangfor-mcp-workflow` | `22` / `>=22 <23` | `pnpm@10.28.1` | `services/sangfor-mcp-workflow/pnpm-lock.yaml` |

Services under `services/*` are **not** members of the root pnpm workspace; they are nested standalone workspaces by design.

## Runtime wrapper

All multi-workspace commands go through:

```bash
bash scripts/run-workspace-runtime.sh <root|engineer|workflow> -- <command...>
```

The wrapper resolves the repo root from its own path (caller cwd is ignored), checks `.nvmrc`, `package.json` name, and `packageManager=pnpm@10.28.1`, selects NVM via a fixed candidate priority list, and `exec`s the command under the exact major. It never runs `nvm install` and never reads `.env*`.

Examples:

```bash
bash scripts/run-workspace-runtime.sh root -- corepack pnpm install --lockfile-only
bash scripts/run-workspace-runtime.sh engineer -- node -e 'console.log(process.version)'
bash scripts/run-workspace-runtime.sh workflow -- corepack pnpm --version
```

## Ports

Canonical registry: **`PORT-MAPPING.yaml`**. Typed defaults live in `packages/config/src/ports.ts` and must agree for the eight core mappings (web 3101, api 3200, postgres 5434, redis 6380, MCP workflow 3500, mock console 3400, engineer bridge 3600, operator console 3502).

Verify:

```bash
bash scripts/run-workspace-runtime.sh root -- node scripts/verify-port-registry.mjs
```

## Output roots

| Workspace | Output root |
|-----------|-------------|
| root | `outputs/` |
| engineer | `services/sangfor-engineer-mcp/outputs/` |
| workflow | `services/sangfor-mcp-workflow/outputs/` |

Paths must stay inside their workspace (no `../` escape).

## CI binding

- Root jobs (`.github/workflows/ci.yml`): `actions/setup-node` uses `node-version-file: .nvmrc`, then **Assert runtime matrix** (major `20`, `corepack pnpm` `10.28.1`).
- Services (`.github/workflows/services-ci.yml`): engineer uses `services/sangfor-engineer-mcp/.nvmrc` (major 20); workflow uses `services/sangfor-mcp-workflow/.nvmrc` (major 22); both assert pnpm `10.28.1`.

## Baseline receipt

Machine-readable snapshot: `docs/12_VERIFICATION/release-baseline.json`.

Full contract check:

```bash
bash scripts/run-workspace-runtime.sh root -- node scripts/check-runtime-contract.mjs --baseline 081a1c0c708104f7d0dd50667a261ea84e9ce85c
```
