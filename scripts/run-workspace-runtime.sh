#!/usr/bin/env bash
# U003 — deterministic workspace runtime wrapper
# Interface: scripts/run-workspace-runtime.sh <root|engineer|workflow> -- <command...>
set -euo pipefail

die64() {
  printf '%s\n' "$*" >&2
  exit 64
}

die69() {
  printf '%s\n' "$*" >&2
  exit 69
}

# Resolve absolute repo root from this script (symlink-aware); never trust caller cwd.
_script_src="${BASH_SOURCE[0]}"
if command -v realpath >/dev/null 2>&1; then
  _script_abs="$(realpath "$_script_src")"
else
  _script_abs="$(cd "$(dirname "$_script_src")" && pwd -P)/$(basename "$_script_src")"
fi
REPO_ROOT="$(cd "$(dirname "$_script_abs")/.." && pwd -P)"

if [[ $# -lt 1 ]]; then
  die64 "usage: run-workspace-runtime.sh <root|engineer|workflow> -- <command...>"
fi

WS="$1"
shift

case "$WS" in
  root)
    WS_CWD="."
    WS_MAJOR="20"
    WS_PKG="sangfor-agentic-os"
    ;;
  engineer)
    WS_CWD="services/sangfor-engineer-mcp"
    WS_MAJOR="20"
    WS_PKG="sangfor-engineer-mcp"
    ;;
  workflow)
    WS_CWD="services/sangfor-mcp-workflow"
    WS_MAJOR="22"
    WS_PKG="sangfor-mcp-workflow"
    ;;
  *)
    die64 "unknown workspace: ${WS}"
    ;;
esac

if [[ $# -lt 1 ]] || [[ "$1" != "--" ]]; then
  die64 "missing -- separator before command"
fi
shift

if [[ $# -lt 1 ]]; then
  die64 "empty command"
fi

TARGET_DIR="${REPO_ROOT}/${WS_CWD}"
cd "$TARGET_DIR" || die64 "cannot cd to ${TARGET_DIR}"

# --- map drift checks (portable grep/sed; do not read .env*) ---
if [[ ! -f .nvmrc ]]; then
  die64 "missing .nvmrc in ${TARGET_DIR}"
fi
_nvmrc_raw="$(tr -d ' \t\r\n' < .nvmrc)"
if [[ "$_nvmrc_raw" != "$WS_MAJOR" ]]; then
  die64 ".nvmrc mismatch: expected ${WS_MAJOR}, got ${_nvmrc_raw}"
fi

if [[ ! -f package.json ]]; then
  die64 "missing package.json in ${TARGET_DIR}"
fi
_pkg_name="$(
  grep -E '"name"[[:space:]]*:' package.json | head -n 1 | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
)"
if [[ "$_pkg_name" != "$WS_PKG" ]]; then
  die64 "package.json name mismatch: expected ${WS_PKG}, got ${_pkg_name}"
fi

_pkg_mgr="$(
  grep -E '"packageManager"[[:space:]]*:' package.json | head -n 1 | sed -E 's/.*"packageManager"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
)"
if [[ "$_pkg_mgr" != "pnpm@10.28.1" ]]; then
  die64 "packageManager mismatch: expected pnpm@10.28.1, got ${_pkg_mgr}"
fi

# GitHub setup-node installs the requested runtime outside nvm. Trust that
# hosted-toolcache runtime only when its major exactly matches this workspace;
# otherwise continue through the deterministic nvm selection below.
if [[ -n "${RUNNER_TOOL_CACHE:-}" ]] && command -v node >/dev/null 2>&1; then
  _preselected_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  if [[ "$_preselected_major" == "$WS_MAJOR" ]]; then
    printf 'run-workspace-runtime: using setup-node major=%s\n' "$WS_MAJOR" >&2
    exec "$@"
  fi
fi

# --- NVM discovery (deterministic priority + realpath canonicalize + dedupe) ---
_canonical_realpath() {
  local p="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$p" 2>/dev/null || return 1
  else
    local d b
    d="$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)" || return 1
    b="$(basename "$p")"
    printf '%s\n' "${d}/${b}"
  fi
}

_raw_candidates=()
if [[ -n "${NVM_DIR:-}" ]]; then
  _raw_candidates+=("${NVM_DIR}/nvm.sh")
fi
if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  _raw_candidates+=("${XDG_CONFIG_HOME}/nvm/nvm.sh")
fi
if [[ -n "${HOME:-}" ]]; then
  _raw_candidates+=("${HOME}/.nvm/nvm.sh")
fi
_raw_candidates+=("/opt/homebrew/opt/nvm/nvm.sh")
_raw_candidates+=("/usr/local/opt/nvm/nvm.sh")

# Build ordered unique canonical list preserving first (highest) raw priority.
_selected=""
_selected_data_dir=""
declare -a _seen_canonicals=()
declare -a _ignored_canonicals=()

for _cand in "${_raw_candidates[@]}"; do
  if [[ ! -f "$_cand" ]] || [[ ! -r "$_cand" ]]; then
    continue
  fi
  # readable regular file only
  if [[ ! -f "$_cand" ]]; then
    continue
  fi
  _canon="$(_canonical_realpath "$_cand")" || die69 "NVM candidate realpath failed: ${_cand}"
  _already=0
  for _s in "${_seen_canonicals[@]+"${_seen_canonicals[@]}"}"; do
    if [[ "$_s" == "$_canon" ]]; then
      _already=1
      break
    fi
  done
  if [[ "$_already" -eq 1 ]]; then
    continue
  fi
  _seen_canonicals+=("$_canon")
  if [[ -z "$_selected" ]]; then
    _selected="$_canon"
    _selected_data_dir="$(dirname "$_canon")"
  else
    _ignored_canonicals+=("$_canon")
  fi
done

if [[ -z "$_selected" ]]; then
  die69 "NVM: zero readable candidates"
fi

printf 'run-workspace-runtime: selected nvm.sh=%s\n' "$_selected" >&2
for _ig in "${_ignored_canonicals[@]+"${_ignored_canonicals[@]}"}"; do
  printf 'run-workspace-runtime: ignored nvm.sh=%s\n' "$_ig" >&2
done

# NVM_DIR export / validation against selected file's data directory
_selected_data_canon="$(_canonical_realpath "$_selected_data_dir")" || die69 "NVM data dir realpath failed"
if [[ -z "${NVM_DIR:-}" ]]; then
  export NVM_DIR="$_selected_data_canon"
else
  _existing_nvm_dir_canon="$(_canonical_realpath "$NVM_DIR")" || die69 "existing NVM_DIR realpath failed"
  if [[ "$_existing_nvm_dir_canon" != "$_selected_data_canon" ]]; then
    die69 "NVM_DIR mismatch: env=${_existing_nvm_dir_canon} selected=${_selected_data_canon}"
  fi
  export NVM_DIR="$_selected_data_canon"
fi

# shellcheck source=/dev/null
. "$_selected"

if ! type nvm >/dev/null 2>&1; then
  die69 "nvm function missing after sourcing nvm.sh"
fi

if ! nvm version "$WS_MAJOR" >/dev/null 2>&1; then
  # nvm version <major> may print N/A; treat missing install as 69 (no nvm install)
  _ver_out="$(nvm version "$WS_MAJOR" 2>/dev/null || true)"
  if [[ -z "$_ver_out" || "$_ver_out" == "N/A" ]]; then
    die69 "nvm version ${WS_MAJOR} unavailable (no install/fallback)"
  fi
fi

nvm use "$WS_MAJOR" >/dev/null || die69 "nvm use ${WS_MAJOR} failed"

# nvm use does not outrank a pre-existing shim path on every shell startup.
# Make the selected runtime authoritative before validating or exec'ing the
# requested workspace command.
if [[ -z "${NVM_BIN:-}" ]] || [[ ! -x "${NVM_BIN}/node" ]]; then
  die69 "NVM selected runtime has no executable node binary"
fi
export PATH="${NVM_BIN}:${PATH}"
hash -r

_actual_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [[ "$_actual_major" != "$WS_MAJOR" ]]; then
  die69 "node major mismatch after nvm use: expected ${WS_MAJOR}, got ${_actual_major}"
fi

# Replace shell with child; preserve argv array and signal/exit status (no eval).
exec "$@"
