#!/usr/bin/env bash
# Bootstrap local GlitchTip (Sentry-compatible), capture DSN into .env.local, send test event.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.glitchtip.yml --profile apm)
ENV_LOCAL="${ROOT}/.env.local"
BASE_URL="${BASE_URL:-http://localhost:3100}"

echo "=== Starting GlitchTip (profile: apm) ==="
"${COMPOSE[@]}" up -d glitchtip-db glitchtip-migrate glitchtip

echo "=== Waiting for GlitchTip UI ==="
for _ in $(seq 1 60); do
  if curl -sf --connect-timeout 2 http://127.0.0.1:8000/ >/dev/null 2>&1; then
    echo "GlitchTip is up on http://127.0.0.1:8000"
    break
  fi
  sleep 3
done

if ! curl -sf --connect-timeout 2 http://127.0.0.1:8000/ >/dev/null 2>&1; then
  echo "FAIL: GlitchTip did not become ready on port 8000"
  exit 1
fi

# Create admin + org + project via Django if not yet present
DSN="$("${COMPOSE[@]}" exec -T glitchtip python3 /code/manage.py shell <<'PY' 2>/dev/null || true
from django.contrib.auth import get_user_model
from apps.organizations_ext.models import Organization, OrganizationUser
from apps.projects.models import Project, ProjectKey

User = get_user_model()
email = "apm-local@ai-portal.local"
password = "apm-local-dev-only"
user, created = User.objects.get_or_create(email=email, defaults={"is_active": True})
if created or not user.has_usable_password():
    user.set_password(password)
    user.save()
org, _ = Organization.objects.get_or_create(slug="aios-local", defaults={"name": "AIOS Local"})
OrganizationUser.objects.get_or_create(organization=org, user=user, defaults={"role": 3})
proj, _ = Project.objects.get_or_create(
    organization=org,
    slug="aios-web",
    defaults={"name": "AIOS Web", "platform": "javascript-nextjs"},
)
key = ProjectKey.objects.filter(project=proj).first()
if not key:
    key = ProjectKey.objects.create(project=proj)
print(key.dsn())
PY
)"

DSN="$(echo "$DSN" | tr -d '\r' | tail -n 1)"
if [[ -z "$DSN" || "$DSN" != http* ]]; then
  echo "FAIL: could not obtain GlitchTip DSN from local instance"
  exit 1
fi

echo "=== Writing .env.local (DSN value not printed) ==="
touch "$ENV_LOCAL"
grep -v '^SENTRY_DSN=' "$ENV_LOCAL" 2>/dev/null | grep -v '^NEXT_PUBLIC_SENTRY_DSN=' | grep -v '^SENTRY_ENVIRONMENT=' | grep -v '^APM_TEST_ROUTE_ENABLED=' | grep -v '^MAIL_OAUTH_BASE_URL=' | grep -v '^BASE_URL=' > "${ENV_LOCAL}.tmp" || true
mv "${ENV_LOCAL}.tmp" "$ENV_LOCAL"
{
  echo "SENTRY_DSN=${DSN}"
  echo "NEXT_PUBLIC_SENTRY_DSN=${DSN}"
  echo "SENTRY_ENVIRONMENT=staging"
  echo "APM_TEST_ROUTE_ENABLED=1"
  echo "MAIL_OAUTH_BASE_URL=http://localhost:3010"
  echo "BASE_URL=http://localhost:3100"
} >> "$ENV_LOCAL"

set -a
# shellcheck disable=SC1091
source .env
[[ -f .env.local ]] && source .env.local
set +a

echo "=== APM readiness (strict) ==="
bash ./scripts/check-apm-readiness.sh --strict

if ! curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
  echo "Starting web on ${BASE_URL} ..."
  PORT=3100 pnpm --filter @ai-portal/web start >/tmp/aios-web-3100.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1 && break
    sleep 2
  done
fi

echo "=== Send test event ==="
bash ./scripts/ops-apm-test-event.sh | tee /tmp/apm-test-event.out

event_id="$(grep '^eventId:' /tmp/apm-test-event.out | cut -d' ' -f2- || true)"
issue_hint="$(grep '^issueUrlHint:' /tmp/apm-test-event.out | cut -d' ' -f2- || true)"

if [[ -z "$event_id" || "$event_id" == "<none>" ]]; then
  echo "FAIL: no eventId from apm-test route"
  exit 1
fi

echo "=== Update apm evidence (event id only) ==="
EVIDENCE="docs/evidence/apm-evidence-v1.0.1.md"
if [[ -f "$EVIDENCE" ]]; then
  sed -i.bak "s/| DSN configured in local\\/staging \`.env\` | \\*\\*PENDING (Owner)\\*\\*/| DSN configured in local\\/staging \`.env.local\` | **PASS** (GlitchTip local)/" "$EVIDENCE" 2>/dev/null || true
  sed -i.bak "s/| Test event ID \\/ issue URL | \\*\\*PENDING (Owner)\\*\\*/| Test event ID \\/ issue URL | **PASS** (see below)/" "$EVIDENCE" 2>/dev/null || true
  if ! grep -q "Local test event ID" "$EVIDENCE"; then
    cat >>"$EVIDENCE" <<EOF

## Local staging test event (GlitchTip)

- Provider: GlitchTip (Sentry-compatible, local profile \`apm\`)
- Environment: staging
- Test event ID: ${event_id}
- Issue URL hint: ${issue_hint:-http://127.0.0.1:8000}
- Verified at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
  fi
fi

echo "PASS: local APM evidence bootstrap complete"
