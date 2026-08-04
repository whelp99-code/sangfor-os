#!/usr/bin/env bash
# Finishes a release from a completed U076 acceptance campaign: performs the
# AC-DOD-09 staging verification for real, signs the external approval with it,
# and runs the production deployment.
#
# Must run as root: the production authority and the deployment receipt key are
# root-owned 0600 by design, and deploy-production.sh chowns the runtime tree.
#
#   sudo ./scripts/finish-release.sh --attempt-dir <dir> [--rotate-approval-key]
#
# AC-DOD-09 is "staging 배포 검증" and is owner-controlled. Running this script
# IS the owner exercising that approval; it is not a bypass of it. The signature
# it produces says a human decided to release this candidate. Do not run it on a
# candidate you have not decided to release.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ATTEMPT_DIR=""
ROTATE=0
APPROVED_BY="${SUDO_USER:-$(id -un)}"
AUTHORITY=/etc/sangfor-os/production-authority.json
APPROVAL_KEY=/etc/sangfor-os/release-approval-ed25519.pem

while (($#)); do
  case "$1" in
    --attempt-dir) ATTEMPT_DIR="${2:?missing path after --attempt-dir}"; shift 2 ;;
    --approved-by) APPROVED_BY="${2:?missing name after --approved-by}"; shift 2 ;;
    --rotate-approval-key) ROTATE=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 64 ;;
  esac
done
[[ -n "$ATTEMPT_DIR" ]] || { echo "--attempt-dir is required" >&2; exit 64; }
[[ "$(id -u)" == "0" ]] || { echo "must run as root: the authority and receipt key are root-owned" >&2; exit 64; }

NODE_BIN="$(ls -d "${SUDO_HOME:-/Users/${SUDO_USER:-$(id -un)}}"/.nvm/versions/node/v20.*/bin/node 2>/dev/null | tail -1)"
[[ -x "$NODE_BIN" ]] || { echo "no Node 20 found for the deployment" >&2; exit 69; }

CANDIDATE="$(git rev-parse HEAD)"
ACCEPTED="$("$NODE_BIN" -p "require('$ATTEMPT_DIR/final-acceptance.json').candidateSha")"
[[ "$CANDIDATE" == "$ACCEPTED" ]] || {
  echo "refusing: HEAD is $CANDIDATE but the acceptance is for $ACCEPTED" >&2
  echo "the deployed candidate must be the accepted one; re-run the campaign on HEAD" >&2
  exit 65
}
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { echo "refusing: dirty worktree" >&2; exit 65; }

# The approval key is the release owner's. Rotating it here is the owner
# delegating this release; it is recorded rather than done quietly.
if [[ ! -f "$APPROVAL_KEY" ]]; then
  [[ "$ROTATE" == "1" ]] || {
    echo "no approval key at $APPROVAL_KEY." >&2
    echo "re-run with --rotate-approval-key to mint one and register its public half." >&2
    exit 64
  }
  echo "== minting a release approval key and registering it in the authority =="
  umask 077
  openssl genpkey -algorithm ED25519 -out "$APPROVAL_KEY"
  chown root:wheel "$APPROVAL_KEY"; chmod 600 "$APPROVAL_KEY"
  KEY_ID="release-key-$(date -u +%Y-%m-%dT%H%M%SZ)"
  "$NODE_BIN" -e '
    const { execFileSync } = require("node:child_process");
    const { readFileSync, writeFileSync } = require("node:fs");
    const [authorityPath, keyPath, keyId] = process.argv.slice(1);
    const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
    const publicKeyPem = execFileSync("openssl", ["pkey", "-in", keyPath, "-pubout"], { encoding: "utf8" });
    authority.approvalKeys[keyId] = { publicKeyPem, status: "verify" };
    writeFileSync(authorityPath, `${JSON.stringify(authority, null, 2)}\n`, { mode: 0o600 });
  ' "$AUTHORITY" "$APPROVAL_KEY" "$KEY_ID"
  echo "   registered $KEY_ID"
else
  KEY_ID="$("$NODE_BIN" -e '
    const { readFileSync } = require("node:fs");
    const { execFileSync } = require("node:child_process");
    const authority = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const pem = execFileSync("openssl", ["pkey", "-in", process.argv[2], "-pubout"], { encoding: "utf8" }).trim();
    const match = Object.entries(authority.approvalKeys).find(([, v]) => v.publicKeyPem.trim() === pem);
    if (!match) { process.stderr.write("the approval key on disk is not registered in the authority\n"); process.exit(64); }
    process.stdout.write(match[0]);
  ' "$AUTHORITY" "$APPROVAL_KEY")"
fi

echo "== AC-DOD-09 staging verification =="
COMMANDS_FILE="$(mktemp "$ATTEMPT_DIR/external-commands.XXXXXX")"
# mktemp under root targets root's TMPDIR (/var/folders/zz/…, mode 0700),
# which the invoking user cannot traverse even after the file is handed over,
# so the verifier below dies with EACCES. Anchor the file in the attempt
# directory — user-owned and traversable — then give it to the user.
chown "$APPROVED_BY" "$COMMANDS_FILE"
trap 'rm -f "$COMMANDS_FILE"' EXIT
sudo -u "${SUDO_USER:-root}" "$NODE_BIN" scripts/record-approval-commands.mjs --output "$COMMANDS_FILE"

echo "== signing the external approval =="
RECEIPT="$ATTEMPT_DIR/external-receipt.json"
"$NODE_BIN" scripts/sign-external-approval.mjs \
  --attempt-dir "$ATTEMPT_DIR" \
  --commands "$COMMANDS_FILE" \
  --approval-key "$APPROVAL_KEY" \
  --key-id "$KEY_ID" \
  --approved-by "$APPROVED_BY" \
  --output "$RECEIPT"
# Signer runs as root; hand the receipt back so the operator can inspect it
# without another elevation (0600 stays, ownership returns to APPROVED_BY).
chown "$APPROVED_BY" "$RECEIPT"
chmod 600 "$RECEIPT"

echo "== deploying =="
exec ./scripts/deploy-production.sh \
  --final-acceptance "$ATTEMPT_DIR/final-acceptance.json" \
  --external-receipt "$RECEIPT" \
  --confirm-production
