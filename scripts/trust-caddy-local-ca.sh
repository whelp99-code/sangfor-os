#!/usr/bin/env bash
# Install the running production Caddy local PKI root into the macOS System
# keychain so browsers can call https://aios.localhost without ERR_CERT_AUTHORITY_INVALID.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${CADDY_CONTAINER:-sangfor-production-caddy-1}"
OUT="${1:-/tmp/caddy-local-root.crt}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Caddy container not running: $CONTAINER" >&2
  exit 69
fi

docker exec "$CONTAINER" cat /data/caddy/pki/authorities/local/root.crt >"$OUT"
chmod 644 "$OUT"
echo "Wrote $OUT"
echo "Installing as System trust root (sudo)…"
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$OUT"
echo "Verifying without -k:"
curl --fail --silent --show-error -o /dev/null -w 'login %{http_code}\n' "https://aios.localhost/login"
curl --fail --silent --show-error -o /dev/null -w 'api/health %{http_code}\n' "https://aios.localhost/api/health"
echo "Done. Restart browsers if they still show the cert warning."
