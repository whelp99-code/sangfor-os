#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${ROOT_DIR}/vendor/open-source/manifest.json"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to sync open-source knowledge vendors." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to read ${MANIFEST}." >&2
  exit 1
fi

if [[ ! -f "${MANIFEST}" ]]; then
  echo "Missing vendor manifest: ${MANIFEST}" >&2
  exit 1
fi

while IFS=$'\t' read -r name repo rel_path commit; do
  dest="${ROOT_DIR}/${rel_path}"
  parent="$(dirname "${dest}")"
  mkdir -p "${parent}"

  if [[ -d "${dest}/.git" ]]; then
    echo "[knowledge-vendor-sync] fetching ${name}"
    git -C "${dest}" fetch --tags --prune origin
  elif [[ -e "${dest}" ]]; then
    echo "[knowledge-vendor-sync] ${dest} exists but is not a git checkout." >&2
    exit 1
  else
    echo "[knowledge-vendor-sync] cloning ${name}"
    git clone "${repo}" "${dest}"
  fi

  echo "[knowledge-vendor-sync] pinning ${name} to ${commit}"
  git -C "${dest}" checkout --detach "${commit}"
done < <(
  python3 - "${MANIFEST}" <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1], encoding="utf-8"))
for repo in manifest["repos"]:
    print(
        repo["name"],
        repo["repo"],
        repo["path"],
        repo["commit"],
        sep="\t",
    )
PY
)

echo "[knowledge-vendor-sync] done"
