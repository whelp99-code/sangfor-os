# launchd jobs

These are the scheduled jobs that drive the production automation loop and watch
over it, plus two host-level helpers. The files here are a record of what is
installed — not an input to a separate templating step.

## Installing

The seven generated jobs are never hand-edited:

```bash
node scripts/launchd/render-launchd-plists.mjs --check                    # list the job set
node scripts/launchd/render-launchd-plists.mjs --out-dir .agents/launchd  # refresh this directory
node scripts/launchd/render-launchd-plists.mjs --out-dir ~/Library/LaunchAgents
for j in mail-sync mail-learn mail-classify autopilot daily-briefing watchdog backup; do
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
no nvm), then runs the script named as its first argument. The endpoint jobs pass
`cron-call.mjs`, which signs a short-lived operator session, refreshes the single
`cron-session-operator` row, and calls the endpoint over Caddy; the watchdog
passes `production-watchdog.mjs`. The script is an argument rather than hardcoded
so both kinds share one copy of that resolution.

## The watchdog

`watchdog` runs at :08/:23/:38/:53 and checks the five containers, the five
endpoint jobs' last exit codes, Caddy ingress, backup freshness, and whether mail
is still landing. On any finding it writes
`.agents/results/kpi/watchdog-status.json`, raises a macOS notification, and
exits non-zero so `launchctl list` shows it too. It also posts to Telegram or
Slack when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` or `SLACK_WEBHOOK_URL` are
set — neither is configured today, so alerts currently reach this host only.
Setting either variable is all that is needed to make them reach a phone.

Before this existed, a job that started failing at 03:00 stayed failing until
somebody happened to run `launchctl list`.

## Backups

`backup` runs daily at 03:10 and takes a logical dump of the production
database, refusing to keep one that `pg_restore --list` cannot read back or that
is implausibly small. It writes a sha256 beside each dump and prunes anything
older than 14 days while never dropping below 5 copies.

This exists because the watchdog's staleness check needed something to satisfy
it: the only backup on this host had been taken by hand, and a day's mail had
already sat unbacked-up for about seventeen hours. Recovery being proven is worth
nothing for data nobody dumped.

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
