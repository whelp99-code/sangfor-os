#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Next.js also reads apps/web/.env* — keep a symlink to the monorepo root file.
ln -sf ../../.env apps/web/.env

pnpm install
docker compose up -d

echo "Waiting for infrastructure health..."
for _ in $(seq 1 30); do
  if docker compose ps --status running 2>/dev/null | grep -q postgres \
    && docker compose ps --status running 2>/dev/null | grep -q redis; then
    break
  fi
  sleep 2
done

echo "Setup complete. Run: pnpm dev"
