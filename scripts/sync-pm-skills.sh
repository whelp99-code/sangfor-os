#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="${ROOT}/vendor/pm-skills"
PM_DEST="${ROOT}/.cursor/skills/pm"
AIOS_SRC="${ROOT}/docs/skills/aios"
AIOS_DEST="${ROOT}/.cursor/skills/aios"

CHECK_MODE=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_MODE=1
fi

# skill_key:upstream_relative_path (under vendor/pm-skills)
PM_SKILLS=(
  "create-prd:pm-execution/skills/create-prd/SKILL.md"
  "prioritize-features:pm-product-discovery/skills/prioritize-features/SKILL.md"
  "analyze-feature-requests:pm-product-discovery/skills/analyze-feature-requests/SKILL.md"
  "identify-assumptions-existing:pm-product-discovery/skills/identify-assumptions-existing/SKILL.md"
  "brainstorm-experiments-existing:pm-product-discovery/skills/brainstorm-experiments-existing/SKILL.md"
  "metrics-dashboard:pm-product-discovery/skills/metrics-dashboard/SKILL.md"
  "pre-mortem:pm-execution/skills/pre-mortem/SKILL.md"
  "test-scenarios:pm-execution/skills/test-scenarios/SKILL.md"
  "user-stories:pm-execution/skills/user-stories/SKILL.md"
  "wwas:pm-execution/skills/wwas/SKILL.md"
)

checksum() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

sync_file() {
  local src="$1"
  local dest="$2"

  if [[ ! -f "${src}" ]]; then
    echo "error: missing source file ${src}" >&2
    exit 1
  fi

  if [[ "${CHECK_MODE}" -eq 1 ]]; then
    if [[ ! -f "${dest}" ]]; then
      echo "error: missing synced file ${dest}" >&2
      exit 1
    fi
    local src_sum dest_sum
    src_sum="$(checksum "${src}")"
    dest_sum="$(checksum "${dest}")"
    if [[ "${src_sum}" != "${dest_sum}" ]]; then
      echo "error: drift detected for ${dest}" >&2
      exit 1
    fi
    return
  fi

  mkdir -p "$(dirname "${dest}")"
  cp "${src}" "${dest}"
}

if [[ ! -d "${VENDOR}" ]]; then
  echo "error: vendor/pm-skills submodule missing. Run: git submodule update --init --recursive" >&2
  exit 1
fi

for entry in "${PM_SKILLS[@]}"; do
  key="${entry%%:*}"
  rel="${entry#*:}"
  src="${VENDOR}/${rel}"
  dest="${PM_DEST}/${key}/SKILL.md"
  sync_file "${src}" "${dest}"
done

if [[ -d "${AIOS_SRC}" ]]; then
  if [[ "${CHECK_MODE}" -eq 1 ]]; then
    if [[ ! -d "${AIOS_DEST}" ]]; then
      echo "error: missing synced directory ${AIOS_DEST}" >&2
      exit 1
    fi
    while IFS= read -r -d '' src; do
      rel="${src#${AIOS_SRC}/}"
      dest="${AIOS_DEST}/${rel}"
      sync_file "${src}" "${dest}"
    done < <(find "${AIOS_SRC}" -type f -print0)
  else
    mkdir -p "${AIOS_DEST}"
    rsync -a --delete "${AIOS_SRC}/" "${AIOS_DEST}/"
  fi
elif [[ "${CHECK_MODE}" -eq 1 && -d "${AIOS_DEST}" ]]; then
  echo "error: aios skills exist in .cursor but docs/skills/aios is missing" >&2
  exit 1
fi

if [[ "${CHECK_MODE}" -eq 1 ]]; then
  echo "pm-skills sync check passed."
else
  echo "pm-skills sync complete."
fi
