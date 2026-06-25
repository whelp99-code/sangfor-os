#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[[ -f .env ]] && set -a && source .env && set +a

echo "==> E2E smoke: infrastructure"
docker compose up -d
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed

echo "==> E2E smoke: lint / test / build"
CI_INTEGRATION=1 pnpm lint
CI_INTEGRATION=1 pnpm test
pnpm build

echo "==> E2E smoke: API health (requires dev server or curl against running app)"
if curl -sf "http://localhost:3000/api/health" >/dev/null 2>&1; then
  curl -sf "http://localhost:3000/api/health" | head -c 200
  echo ""
else
  echo "Dev server not running on :3000 — skipping live HTTP checks (CI build verified)."
fi

echo "==> E2E smoke: complete"
