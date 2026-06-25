#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
[[ -f .env ]] && set -a && source .env && set +a

GITHUB_OWNER="${GITHUB_OWNER:-whelp99-code}"
GITHUB_REPO="${GITHUB_REPO:-ai-automation-work-portal}"
GITHUB_HOST="${GITHUB_HOST:-github.com}"

auth_gh() {
  if gh auth status --hostname "$GITHUB_HOST" >/dev/null 2>&1; then
    echo "gh already authenticated for $GITHUB_HOST"
    return 0
  fi

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo "$GITHUB_TOKEN" | gh auth login --hostname "$GITHUB_HOST" --with-token
    return 0
  fi

  local cred
  cred="$(printf "protocol=https\nhost=%s\n" "$GITHUB_HOST" | git credential fill)"
  local token
  token="$(printf '%s\n' "$cred" | awk -F= '/^password=/{print $2}')"
  if [[ -z "$token" ]]; then
    echo "No GitHub token available. Set GITHUB_TOKEN in .env or configure git credentials."
    exit 1
  fi
  printf '%s\n' "$token" | gh auth login --hostname "$GITHUB_HOST" --with-token
}

ensure_repo() {
  if gh repo view "$GITHUB_OWNER/$GITHUB_REPO" --hostname "$GITHUB_HOST" >/dev/null 2>&1; then
    echo "Repository $GITHUB_OWNER/$GITHUB_REPO already exists"
  else
    gh repo create "$GITHUB_OWNER/$GITHUB_REPO" \
      --private \
      --description "AI Automation Work Portal — AI업무포탈 with embedded dev automation kernel" \
      --homepage "https://github.com/$GITHUB_OWNER/$GITHUB_REPO" || {
        if gh repo view "$GITHUB_OWNER/$GITHUB_REPO" >/dev/null 2>&1; then
          echo "Repository already exists (race or prior create)"
        else
          exit 1
        fi
      }
    echo "Created repository $GITHUB_OWNER/$GITHUB_REPO"
  fi

  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "https://github.com/$GITHUB_OWNER/$GITHUB_REPO.git"
  else
    git remote add origin "https://github.com/$GITHUB_OWNER/$GITHUB_REPO.git"
  fi
}

push_branches() {
  git push -u origin main
  git push -u origin develop
  git push -u origin infra/project-bootstrap
  git push -u origin feature/db-kernel-v1
  git push origin HEAD
}

protect_branch() {
  local branch="$1"
  if gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "/repos/$GITHUB_OWNER/$GITHUB_REPO/branches/$branch/protection" \
    -f required_status_checks[strict]=true \
    -F required_status_checks[contexts][]=CI \
    -F required_status_checks[contexts][]=Secret\ Scan \
    -f enforce_admins=false \
    -f required_pull_request_reviews[required_approving_review_count]=1 \
    -f restrictions=null \
    >/dev/null 2>&1; then
    echo "Branch protection enabled for $branch"
  else
    echo "Branch protection API unavailable (private repo plan). Using enforce-branch-policy workflow."
  fi
}

auth_gh
ensure_repo
push_branches

# CI job names must match workflow job ids for required checks
protect_branch main || echo "Note: enable required checks after first CI run (job id: verify, gitleaks)"
protect_branch develop || true

echo "GitHub setup complete: https://github.com/$GITHUB_OWNER/$GITHUB_REPO"
