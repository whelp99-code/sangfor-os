#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi
if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a && source .env.local && set +a
fi

soft=0
base_url="${MAIL_OAUTH_BASE_URL:-http://localhost:10200}"
for arg in "$@"; do
  case "$arg" in
    --soft)
      soft=1
      ;;
    --base-url=*)
      base_url="${arg#*=}"
      ;;
    --help)
      echo "Usage: $0 [--soft] [--base-url=<url>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      exit 1
      ;;
  esac
done

if [[ -z "$base_url" ]]; then
  echo "Error: MAIL_OAUTH_BASE_URL is not set and no --base-url provided."
  exit 1
fi

set +e
curl --connect-timeout 3 --max-time 8 -sf "${base_url}/api/auth/microsoft/status" -o /tmp/mail-oauth-status.json
curl_exit=$?
set -e

if [[ $curl_exit -ne 0 ]]; then
  echo "FAIL: cannot reach mail auth status at ${base_url}/api/auth/microsoft/status"
  if [[ "$soft" -eq 1 ]]; then
    echo "NOTE: soft mode enabled; treating as warning."
    exit 0
  fi
  exit 1
fi

status=$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('/tmp/mail-oauth-status.json','utf8')); console.log(d.status||'');" 2>/dev/null || echo "")
connected=$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('/tmp/mail-oauth-status.json','utf8')); console.log(d.connected === true || d.status === 'connected' ? 1 : 0);" 2>/dev/null || echo "0")
error=$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('/tmp/mail-oauth-status.json','utf8')); console.log(d.lastErrorCode||d.connectionError||'');" 2>/dev/null || echo "")
account_email=$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('/tmp/mail-oauth-status.json','utf8')); console.log(d.email||'');" 2>/dev/null || echo "")

printf "Mail OAuth status: %s\n" "${status:-<missing>}"
printf "Account email: %s\n" "${account_email:-<none>}"
printf "Connected: %s\n" "${connected}"
if [[ -n "$error" ]]; then
  printf "Last error code: %s\n" "$error"
fi

if [[ "$status" == "reconnect_required" ]]; then
  connect_url="${base_url}/api/auth/microsoft/connect?redirect=1&force=1"
  echo "FAIL: mail OAuth requires reconnect."
  echo "Open the browser and complete Microsoft re-consent:"
  echo "  ${connect_url}"
  echo "Then re-run this script to verify status moved to 'connected'."
  if [[ "$soft" -eq 1 ]]; then
    echo "NOTE: soft mode enabled; treating reconnect_required as non-fatal."
    exit 0
  fi
  exit 1
fi

if [[ "$status" != "connected" ]]; then
  echo "FAIL: mail OAuth status does not indicate a connected account."
  if [[ "$soft" -eq 1 ]]; then
    echo "NOTE: soft mode enabled; treating non-connected status as non-fatal."
    exit 0
  fi
  exit 1
fi

echo "PASS: Mail OAuth connection looks healthy."
exit 0
