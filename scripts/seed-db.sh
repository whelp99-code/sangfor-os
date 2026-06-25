#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -f .env ]] || cp .env.example .env

pnpm db:migrate:deploy
pnpm db:seed
echo "Database seeded (command_run chain + audit samples)."
