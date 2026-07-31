#!/usr/bin/env node
/**
 * production-watchdog.mjs — notices when the production stack or its scheduled
 * jobs stop working, and tells someone.
 *
 * Until now nothing did. A cron job that started failing at 03:00 stayed failing
 * until somebody happened to run `launchctl list`, and a stopped container looked
 * identical to a healthy one from the outside. Automation without a failure
 * signal is not operations.
 *
 * Emission is deliberately layered so this works today and improves without a
 * code change: it posts to Telegram or Slack when those are configured, always
 * raises a macOS notification, always writes a status file, and always exits
 * non-zero when something is wrong so `launchctl list` shows it too.
 *
 * Usage:
 *   node scripts/production-watchdog.mjs           # check, alert, exit 1 on findings
 *   node scripts/production-watchdog.mjs --quiet   # no notification, status file only
 *   node scripts/production-watchdog.mjs --print   # show the snapshot it collected
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? "sangfor-production";

export const EXPECTED_CONTAINERS = ["web", "api", "postgres", "redis", "caddy"];
export const EXPECTED_JOBS = ["mail-sync", "mail-learn", "mail-classify", "autopilot", "daily-briefing"];

/** Caddy is the only ingress; web and api are expose-only. */
const INGRESS_URL = "https://aios.localhost/api/health";
/** mail-sync runs at :00/:30, so nothing newer than this means it stopped landing. */
export const MAIL_SYNC_STALE_MS = 90 * 60 * 1000;
/** A backup older than this is a data-loss window nobody chose. */
export const BACKUP_STALE_MS = 26 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Evaluation — pure, so the rules are testable without a live stack.
// ---------------------------------------------------------------------------

/**
 * @param {object} snapshot
 * @returns {{ok: boolean, findings: Array<{severity: "critical"|"warning", subject: string, detail: string}>}}
 */
export function evaluateHealth(snapshot) {
  const findings = [];
  const add = (severity, subject, detail) => findings.push({ severity, subject, detail });

  for (const name of EXPECTED_CONTAINERS) {
    const container = snapshot.containers?.find((c) => c.name === name);
    if (!container) {
      add("critical", `container/${name}`, "not present");
      continue;
    }
    if (!container.running) {
      add("critical", `container/${name}`, `not running (${container.state ?? "unknown"})`);
      continue;
    }
    // Caddy declares no healthcheck, so "none" is expected there and only there.
    if (container.health && container.health !== "healthy" && container.health !== "none") {
      add("critical", `container/${name}`, `health ${container.health}`);
    }
  }

  if (snapshot.ingress?.status !== 200) {
    add("critical", "ingress", `GET /api/health returned ${snapshot.ingress?.status ?? "no response"}`);
  }

  for (const name of EXPECTED_JOBS) {
    const job = snapshot.jobs?.find((j) => j.name === name);
    if (!job) {
      add("critical", `job/${name}`, "not loaded in launchd");
      continue;
    }
    if (job.lastExitCode !== 0) {
      add("warning", `job/${name}`, `last exit ${job.lastExitCode}`);
    }
  }

  const syncAge = ageMs(snapshot.now, snapshot.mailAccount?.lastSyncedAtMs);
  if (snapshot.mailAccount?.lastSyncedAtMs == null) {
    add("warning", "mail-sync", "no mailbox has ever synced");
  } else if (syncAge > MAIL_SYNC_STALE_MS) {
    add("warning", "mail-sync", `last sync ${Math.round(syncAge / 60000)} min ago`);
  }

  const backupAge = ageMs(snapshot.now, snapshot.backup?.latestMtimeMs);
  if (snapshot.backup?.latestMtimeMs == null) {
    add("critical", "backup", "no backup artifact found");
  } else if (backupAge > BACKUP_STALE_MS) {
    add("critical", "backup", `newest backup ${Math.round(backupAge / 3600000)} h old`);
  }

  return { ok: findings.length === 0, findings };
}

function ageMs(nowMs, thenMs) {
  if (typeof nowMs !== "number" || typeof thenMs !== "number") return Number.POSITIVE_INFINITY;
  return nowMs - thenMs;
}

export function formatFindings(findings) {
  if (findings.length === 0) return "production stack healthy";
  const worst = findings.some((f) => f.severity === "critical") ? "CRITICAL" : "WARNING";
  const lines = findings.map((f) => `- [${f.severity}] ${f.subject}: ${f.detail}`);
  return `${worst}: ${findings.length} finding(s)\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function quiet(bin, args) {
  try {
    // stderr is discarded on purpose: a probe that cannot answer is a finding,
    // and this runs on a schedule where a daemon's chatter would bury the verdict.
    return execFileSync(bin, args, {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function collectContainers() {
  // One docker call; a per-container loop would report "missing" for all of them
  // whenever the daemon is merely slow to answer.
  const raw = quiet("docker", [
    "ps", "-a",
    "--filter", `label=com.docker.compose.project=${PROJECT}`,
    "--format", "{{.Names}}\t{{.State}}\t{{.Status}}",
  ]);
  return raw.split("\n").filter(Boolean).map((line) => {
    const [names, state, status] = line.split("\t");
    const service = names.replace(`${PROJECT}-`, "").replace(/-\d+$/, "");
    const health = /\(healthy\)/.test(status) ? "healthy"
      : /\(unhealthy\)/.test(status) ? "unhealthy"
      : /\(health: starting\)/.test(status) ? "starting"
      : "none";
    return { name: service, running: state === "running", state, health };
  });
}

function collectJobs() {
  const raw = quiet("launchctl", ["list"]);
  return EXPECTED_JOBS.map((name) => {
    const label = `com.jmpark.sangfor.${name}`;
    const line = raw.split("\n").find((l) => l.endsWith(`\t${label}`) || l.endsWith(` ${label}`));
    if (!line) return { name, lastExitCode: null, loaded: false };
    const exitField = line.trim().split(/\s+/)[1];
    return { name, lastExitCode: Number.parseInt(exitField, 10), loaded: true };
  });
}

function collectIngress() {
  // curl rather than fetch: the local cert is self-signed, and reaching for
  // NODE_TLS_REJECT_UNAUTHORIZED made Node print a security warning on every
  // scheduled run. `-k` scopes the exception to this one probe, which is about
  // reachability rather than trust.
  const status = quiet("curl", [
    "-sk", "-o", "/dev/null", "-w", "%{http_code}",
    "--max-time", "15", INGRESS_URL,
  ]);
  const parsed = Number.parseInt(status, 10);
  return { status: Number.isFinite(parsed) && parsed > 0 ? parsed : null };
}

function collectBackup() {
  const dir = process.env.BACKUP_DIR
    ?? join(process.env.HOME ?? "", "Library/Application Support/SangforOS/production-backups");
  try {
    const newest = readdirSync(dir)
      .filter((f) => f.endsWith(".dump"))
      .map((f) => statSync(join(dir, f)).mtimeMs)
      .sort((a, b) => b - a)[0];
    return { latestMtimeMs: newest ?? null, dir };
  } catch {
    return { latestMtimeMs: null, dir };
  }
}

function collectMailAccount() {
  const raw = quiet("docker", [
    "exec", `${PROJECT}-postgres-1`,
    "psql", "-U", "sangfor", "-d", process.env.POSTGRES_DB ?? "sangfor_os",
    "-Atc", "SELECT COALESCE(MAX(EXTRACT(EPOCH FROM last_synced_at) * 1000)::bigint, 0) FROM mail_accounts",
  ]);
  const ms = Number.parseInt(raw, 10);
  return { lastSyncedAtMs: Number.isFinite(ms) && ms > 0 ? ms : null };
}

export function collectSnapshot() {
  return {
    now: Date.now(),
    containers: collectContainers(),
    jobs: collectJobs(),
    ingress: collectIngress(),
    backup: collectBackup(),
    mailAccount: collectMailAccount(),
  };
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

async function notify(title, body) {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const telegramChat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (telegramToken && telegramChat) {
    try {
      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramChat, text: `${title}\n${body}` }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch { /* a failed alert must not mask the finding it was reporting */ }
  }

  const slack = process.env.SLACK_WEBHOOK_URL?.trim();
  if (slack) {
    try {
      await fetch(slack, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${title}*\n${body}` }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch { /* same */ }
  }

  // Always available on this host, and the only channel that needs no secret.
  const escaped = (value) => value.replace(/["\\]/g, "\\$&").replace(/\n/g, " ");
  quiet("osascript", ["-e", `display notification "${escaped(body)}" with title "${escaped(title)}"`]);
}

function writeStatus(snapshot, verdict) {
  const dir = join(REPO_ROOT, ".agents/results/kpi");
  mkdirSync(dir, { recursive: true });
  const status = {
    schemaVersion: 1,
    checkedAt: new Date(snapshot.now).toISOString(),
    ok: verdict.ok,
    findings: verdict.findings,
    observed: {
      containers: snapshot.containers,
      jobs: snapshot.jobs,
      ingressStatus: snapshot.ingress?.status ?? null,
      backupLatest: snapshot.backup?.latestMtimeMs
        ? new Date(snapshot.backup.latestMtimeMs).toISOString() : null,
      mailLastSynced: snapshot.mailAccount?.lastSyncedAtMs
        ? new Date(snapshot.mailAccount.lastSyncedAtMs).toISOString() : null,
    },
  };
  writeFileSync(join(dir, "watchdog-status.json"), `${JSON.stringify(status, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const snapshot = collectSnapshot();
  if (args.includes("--print")) process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  const verdict = evaluateHealth(snapshot);
  writeStatus(snapshot, verdict);
  const summary = formatFindings(verdict.findings);
  process.stdout.write(`${summary}\n`);
  if (!verdict.ok && !args.includes("--quiet")) {
    await notify("Sangfor production watchdog", summary);
  }
  process.exit(verdict.ok ? 0 : 1);
}
