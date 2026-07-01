#!/usr/bin/env bash
# round-ship.sh — commit the current worktree changes, open a PR, and enable
# auto-merge (squash). Collapses the per-round git/gh boilerplate from the
# improvement loop into one command.
#
# Requires: repo "Allow auto-merge" ON + branch protection with required checks
# on main (see docs/DEV_REFERENCE — Auto-merge). Without branch protection,
# --auto merges immediately once mergeable (no CI gate).
#
# Usage:
#   scripts/round-ship.sh <branch> "<title>" ["<body>"]
# Example:
#   scripts/round-ship.sh improve/round-23 "fix(round-23): tidy X" "details…"
set -euo pipefail
BRANCH="${1:?usage: round-ship.sh <branch> <title> [body]}"
TITLE="${2:?title required}"
BODY="${3:-}"
BASE="${BASE_BRANCH:-main}"

git switch -c "$BRANCH" 2>/dev/null || git switch "$BRANCH"
git add -A
git commit -q -m "$TITLE" ${BODY:+-m "$BODY"} || { echo "nothing to commit"; }
git push -u origin "$BRANCH"
gh pr create --base "$BASE" --head "$BRANCH" --title "$TITLE" --body "${BODY:-$TITLE}"
# Enable auto-merge (squash). Merges when required checks go green.
# Falls back gracefully if branch protection isn't configured (auto-merge then
# has nothing to gate on — merge manually after CI, or add required checks).
if gh pr merge --auto --squash --delete-branch 2>/tmp/round-ship-merge.err; then
  echo "✅ auto-merge enabled — merges when CI is green.  watch:  gh pr checks --watch"
else
  echo "ℹ auto-merge not enabled ($(tr -d '\n' </tmp/round-ship-merge.err | tail -c 160))"
  echo "  → add branch protection (docs/DEV_REFERENCE — Auto-merge), or merge after CI:"
  echo "    gh pr checks --watch && gh pr merge --squash --delete-branch"
fi
