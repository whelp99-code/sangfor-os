# launchd jobs

These are the scheduled jobs that drive the production automation loop, plus two
host-level helpers. The files here are a record of what is installed — not an
input to a separate templating step.

## Installing

The five automation-loop jobs are generated, never hand-edited:

```bash
node scripts/launchd/render-launchd-plists.mjs --check                    # list the job set
node scripts/launchd/render-launchd-plists.mjs --out-dir .agents/launchd  # refresh this directory
node scripts/launchd/render-launchd-plists.mjs --out-dir ~/Library/LaunchAgents
for j in mail-sync mail-learn mail-classify autopilot daily-briefing; do
  launchctl bootout   "gui/$(id -u)/com.jmpark.sangfor.$j" 2>/dev/null
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jmpark.sangfor.$j.plist"
done
```

`scripts/launchd/render-launchd-plists.mjs` holds the schedule and arguments for
every job. Change it there and re-render; editing a plist by hand puts the
installed job and this directory back out of step, which is how the previous set
came to call `http://localhost:3101` long after the production compose stopped
publishing that port.

## Why every job goes through run-cron.sh

Production publishes nothing but Caddy on :80/:443 — web and api are
`expose`-only. A job also cannot simply curl through Caddy: the proxy requires a
DB-backed session for every non-public `/api` path. `scripts/launchd/run-cron.sh`
resolves docker and a Node 20 binary (launchd starts jobs with a minimal PATH and
no nvm), then hands off to `cron-call.mjs`, which signs a short-lived operator
session, refreshes the single `cron-session-operator` row, and calls the endpoint
over Caddy.

## Mail pipeline order

The three mail jobs are a chain, and the schedule encodes it:

| :00 / :30 | `mail-sync` | fetch inbox and sent mail into `mail_messages` |
| :03 / :33 | `mail-learn` | group messages into `mail_insight_threads` |
| :05 | `mail-classify` | classify threads into `mail_derived_candidates` |

`mail-classify` reads `mail_insight_threads`, which only `mail-learn` writes.
Without the middle step the first two stages look healthy while the third scans
nothing — the state this directory was in when 1329 synced messages had produced
zero candidates.

## Host helpers

`boot-stack` and `kpi-weekly` call `scripts/boot-stack.sh` and
`scripts/kpi-weekly.sh` directly rather than going through `run-cron.sh`; they
are recorded here as installed and are not generated.
