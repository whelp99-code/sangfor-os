# Work tracker standard (mandatory)

**Primary tracker: GitHub Issues + labels (+ Projects when token has `project` scope).**  
**Not primary: Linear.** Do not open Linear issues for new work unless the human explicitly asks.

This applies to **all planning and execution** from the next task onward (agents included).

## System map

| Layer | System | Role |
|---|---|---|
| Work unit | **GitHub Issue** | What / why / status |
| Implementation | **JM** (`jm-acloud`, repo checkout) | Code, commits, PRs |
| Verification | **GitHub Actions** | lint/test/build/e2e (Docker gate) |
| Runtime | **BLRO** (`ssh blro`, `/home/blro/sangfor-os`) | migrate/deploy/import/smoke |
| Optional board UI | GitHub Projects | Same statuses as labels when available |

Roles detail: agent memory `reference/project/jm-blro-roles.md` and `reference/project/blro-ops-access.md`.


## Orca UI: where to look (1 + 2)

You will see **two different surfaces** in Orca. They are not the same tracker.

### 1) Default work view = GitHub Issues (use this)

| Want | Do this |
|---|---|
| All open work | Browser: https://github.com/whelp99-code/sangfor-os/issues |
| BLRO queue only | https://github.com/whelp99-code/sangfor-os/issues?q=is%3Aissue+is%3Aopen+label%3Aready-for-blro |
| CLI list | `./scripts/tracker.sh list` or `gh issue list` |
| CLI BLRO | `./scripts/tracker.sh blro` |
| Open in browser from JM | `./scripts/tracker.sh open` / `open-blro` |

**Bookmark these two URLs** (browser or Orca embedded browser).  
That is the daily board. Labels `status:*` + `ready-for-blro` replace Linear columns.

Orca left sidebar workspace tree (`sangfor-os`, branches, agents) = **code sessions**, not the issue backlog.

### 2) Linear tab = reference only (do not plan new work here)

The Orca screen titled **Linear · …** / **Search Linear issues…** / keys like `WHE-7` is the **old Linear mirror**.

| Do | Don't |
|---|---|
| Glance at legacy epics if needed | Create new work as Linear issues |
| Leave historical `WHE-*` as archive | Treat Linear Todo/In progress as source of truth |
| Close/ignore Linear onboarding leftovers when convenient | Ask agents to `orca linear` for the main queue |

**Workspace board** columns (Todo / In progress / In review / Done) mix **repos, branches, agent tasks** — useful for multi-project glance, **not** a substitute for GitHub Issues.

If something appears only on Linear and is still real work: **mirror it into a GitHub Issue** and continue only on GitHub.


## Status model (labels)

Use **one** `status:*` label on open issues (Done = close the issue).

| Status label | Meaning |
|---|---|
| `status:backlog` | Not started |
| `status:in-progress` | JM implementing |
| `status:in-review` | PR open; waiting on CI/review |
| `ready-for-blro` | Merged/verified; **BLRO apply remaining** |
| `status:blocked` | Cannot proceed (also `ci-blocked` if CI) |
| closed | Done |

### Other labels
- `blro` — touches BLRO host
- `ops` — migrate/deploy/import/smoke
- `agent` — agent may execute under normal gates
- `ci-blocked` — Actions failure
- `tracker:github` — reminds tooling this is the GitHub tracker path

## Agent workflow (every task)

1. **Plan** → open or reuse a GitHub Issue (template: Feature / Bug / BLRO ops).
2. **Implement on JM** → branch + PR; PR body uses `.github/pull_request_template.md`.
3. **Link** → `Closes #N` in PR.
4. **Verify** → local checks + **Actions CI** (never claim Docker-gate green from JM alone if Docker missing).
5. **If runtime apply needed** → after merge, issue keeps/gets `ready-for-blro` `ops` `blro`.
6. **BLRO** → `ssh blro`, work in `/home/blro/sangfor-os`, post evidence on the issue, then **close**.
7. **Do not** use `orca linear` as the default work queue.

### CLI cheatsheet

```bash
# list work
gh issue list --repo whelp99-code/sangfor-os --label 'status:in-progress'
gh issue list --repo whelp99-code/sangfor-os --label ready-for-blro

# create
gh issue create --repo whelp99-code/sangfor-os --template feature.yml

# status transitions (example → in progress)
gh issue edit N --add-label 'status:in-progress' --remove-label 'status:backlog'

# after merge, needs BLRO
gh issue edit N --add-label ready-for-blro --add-label ops --add-label blro --remove-label 'status:in-review'

# done
gh issue close N --comment "Evidence: …"
```

## GitHub Projects note

Creating/managing **Projects v2** requires a `gh` token with `read:project` + `project` scopes.  
If missing, **labels are the source of truth** (this repo’s default). When scopes exist:

```bash
gh auth refresh -h github.com -s read:project,project
# then create a user/org project and attach issues; mirror the same status names
```

## Linear

- Existing Orca Linear integration may remain installed.
- **New plans and execution must not depend on Linear.**
- If a legacy Linear issue appears, mirror it into a GitHub Issue and continue only on GitHub.

## Cost / why

- Linear Free is not “250 issues per month”; it is a small free ceiling then paid seats.
- GitHub Issues/PRs/Actions are already the center of this repo’s gravity.
- Orca agents operate with `gh` + `ssh blro` without a paid tracker.
