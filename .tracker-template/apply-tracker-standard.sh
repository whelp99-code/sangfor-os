#!/usr/bin/env bash
# Apply GitHub Issues tracker standard into a git repo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${1:-.}" && pwd)"
cd "$REPO_ROOT"

if [ ! -d .git ]; then
  echo "SKIP no-git: $REPO_ROOT"
  exit 0
fi

REMOTE="$(git remote get-url origin 2>/dev/null || true)"
GH_REPO=""
if [[ "$REMOTE" =~ github.com[:/](.+/[^/.]+)(\.git)?$ ]]; then
  GH_REPO="${BASH_REMATCH[1]}"
  GH_REPO="${GH_REPO%.git}"
fi

echo "=== APPLY $REPO_ROOT remote=${REMOTE:-none} gh=${GH_REPO:-none} ==="

mkdir -p .github/ISSUE_TEMPLATE docs scripts
cp -f "$ROOT/.github/ISSUE_TEMPLATE/"*.yml .github/ISSUE_TEMPLATE/
cp -f "$ROOT/.github/pull_request_template.md" .github/
cp -f "$ROOT/docs/TRACKER.md" docs/TRACKER.md
cp -f "$ROOT/scripts/tracker.sh" scripts/tracker.sh
chmod +x scripts/tracker.sh

if [ -n "$GH_REPO" ]; then
  sed -i "s|whelp99-code/sangfor-os|${GH_REPO}|g" scripts/tracker.sh
fi

python3 - <<'PY'
from pathlib import Path
block = """## Work tracking (mandatory)
- **Primary tracker: GitHub Issues + labels** (not Linear). See [docs/TRACKER.md](docs/TRACKER.md).
- JM = code/PRs · GitHub Actions = verify · BLRO = `ssh blro` runtime when needed.
- Orca **Linear** tab / Workspace board = reference/sessions only.
- Every plan/execution unit is a GitHub Issue; PRs use `Closes #N`.

"""
p = Path("AGENTS.md")
if p.exists():
    t = p.read_text()
    if "Work tracking (mandatory)" in t:
        print("AGENTS.md already has work tracking")
    else:
        lines = t.splitlines(True)
        if lines and lines[0].startswith("#"):
            i = 1
            while i < len(lines) and lines[i].strip() != "":
                i += 1
            while i < len(lines) and lines[i].strip() == "":
                i += 1
            t = "".join(lines[:i]) + block + "".join(lines[i:])
        else:
            t = block + t
        p.write_text(t)
        print("AGENTS.md updated")
else:
    p.write_text("# Agent entry\n\n" + block)
    print("AGENTS.md created")

pj = Path("package.json")
if pj.exists():
    import json
    try:
        j = json.loads(pj.read_text())
    except Exception as e:
        print("package.json skip", e)
    else:
        j.setdefault("scripts", {})
        j["scripts"]["tracker"] = "bash scripts/tracker.sh"
        j["scripts"]["tracker:blro"] = "bash scripts/tracker.sh blro"
        j["scripts"]["tracker:open"] = "bash scripts/tracker.sh open"
        pj.write_text(json.dumps(j, indent=2, ensure_ascii=False) + "\n")
        print("package.json tracker scripts")
PY

if [ -n "$GH_REPO" ] && command -v gh >/dev/null; then
  while IFS='|' read -r name color desc; do
    color="${color#\#}"
    gh label create "$name" --repo "$GH_REPO" --color "$color" --description "$desc" 2>/dev/null \
      || gh label edit "$name" --repo "$GH_REPO" --color "$color" --description "$desc" 2>/dev/null \
      || true
  done <<'LABELS'
blro|#0E8A16|Runtime work on BLRO host (ssh blro)
ops|#1D76DB|Operational task: migrate/deploy/import/smoke
agent|#5319E7|Safe for agent execution with standard gates
ci-blocked|#D93F0B|Blocked on CI failure
ready-for-blro|#FBCA04|Code merged/verified; needs BLRO apply
status:backlog|#C5DEF5|Tracker status: Backlog
status:in-progress|#FBCA04|Tracker status: In Progress (JM)
status:in-review|#0052CC|Tracker status: In Review (PR+CI)
status:blocked|#B60205|Tracker status: Blocked
tracker:github|#000000|Primary work tracker is GitHub Issues (not Linear)
LABELS
  gh api "repos/$GH_REPO/milestones" --method POST \
    -f title='Ready for BLRO' -f state='open' \
    -f description='Merged/verified work waiting for BLRO runtime apply.' >/dev/null 2>&1 || true
  echo "labels/milestones ok for $GH_REPO"
fi

if [ -n "$(git status --porcelain)" ]; then
  git add AGENTS.md docs/TRACKER.md scripts/tracker.sh .github/ISSUE_TEMPLATE .github/pull_request_template.md package.json 2>/dev/null || true
  git add -A -- .github docs/TRACKER.md scripts/tracker.sh AGENTS.md package.json 2>/dev/null || true
  if ! git commit -m "$(cat <<'MSG'
docs: adopt GitHub Issues as primary work tracker

Standardize planning/execution on GitHub Issues + labels (not Linear).
Add issue/PR templates, docs/TRACKER.md, and scripts/tracker.sh.
Orca Linear tab remains reference-only; JM implements, Actions verifies,
BLRO applies when labeled ready-for-blro.
MSG
)"; then
    echo "commit skipped or failed"
  fi
  BRANCH="$(git branch --show-current)"
  if git remote get-url origin >/dev/null 2>&1; then
    if ! git push -u origin HEAD 2>&1; then
      echo "PUSH_FAILED $REPO_ROOT branch=$BRANCH"
    fi
  fi
else
  echo "clean no commit"
fi

echo "DONE $REPO_ROOT"
