#!/usr/bin/env node
/**
 * render-launchd-plists.mjs — the single source of truth for the scheduled jobs
 * that drive the production automation loop.
 *
 * The tracked copies under .agents/launchd/ used to be hand-maintained and drifted
 * badly: they still called http://localhost:3101 directly, which the production
 * compose never exposes, so reinstalling from them reintroduced a fleet of jobs
 * that failed on every run. Generating them from this list keeps the installed
 * jobs and the repo's record of them from disagreeing again.
 *
 * Usage:
 *   node scripts/launchd/render-launchd-plists.mjs --out-dir <dir>   # write plists
 *   node scripts/launchd/render-launchd-plists.mjs --check           # print job set
 *
 * Every job runs run-cron.sh, which signs an operator session and calls the
 * endpoint through Caddy. Order matters inside the mail pipeline: mail-import
 * fetches messages, mail-learn groups them into insight threads, and only then
 * can mail-candidates classify anything — a gap that left 1329 synced messages
 * producing zero candidates.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");
const LABEL_PREFIX = "com.jmpark.sangfor";

/** Minute-of-hour entries. */
const at = (...minutes) => minutes.map((minute) => ({ Minute: minute }));
/** Weekday (Mon–Fri) entries at a fixed time. */
const weekdaysAt = (hour, minute) =>
  [1, 2, 3, 4, 5].map((Weekday) => ({ Weekday, Hour: hour, Minute: minute }));

/** Every job runs through run-cron.sh; `script` says what that wrapper then executes. */
const CRON_CALL = "scripts/launchd/cron-call.mjs";
const WATCHDOG = "scripts/production-watchdog.mjs";

export const LAUNCHD_JOBS = [
  {
    name: "mail-sync",
    script: CRON_CALL,
    args: ["--path", "/api/mail-import", "--method", "POST", "--body", "{}"],
    schedule: at(0, 30),
    note: "Pull inbox and sent mail from the connected mailbox.",
  },
  {
    name: "mail-learn",
    script: CRON_CALL,
    args: ["--path", "/api/mail-learn", "--method", "POST", "--body", "{}"],
    schedule: at(3, 33),
    note: "Group synced mail into insight threads. Must run after mail-sync and before mail-classify.",
  },
  {
    name: "mail-classify",
    script: CRON_CALL,
    args: ["--path", "/api/mail-candidates", "--method", "POST", "--body", '{"limit":50}'],
    schedule: at(5),
    note: "Classify insight threads into business candidates.",
  },
  {
    name: "autopilot",
    script: CRON_CALL,
    args: ["--path", "/api/autopilot/run", "--method", "POST", "--body", '{"limit":20}'],
    schedule: at(20),
    note: "Run one autopilot pass over pending candidates.",
  },
  {
    name: "daily-briefing",
    script: CRON_CALL,
    args: ["--path", "/api/daily-report?brief=1", "--method", "GET"],
    schedule: weekdaysAt(8, 5),
    note: "Weekday morning briefing.",
  },
  {
    name: "watchdog",
    script: WATCHDOG,
    args: [],
    // Every quarter hour: often enough that a stopped container or a failing job
    // is noticed within one mail-sync interval rather than whenever someone next
    // runs `launchctl list`.
    schedule: at(8, 23, 38, 53),
    note: "Check containers, jobs, ingress, backup freshness and mail liveness; alert on findings.",
  },
];

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderCalendarEntry(entry, indent) {
  const pad = " ".repeat(indent);
  const keys = Object.entries(entry)
    .map(([key, value]) => `${pad}  <key>${key}</key>\n${pad}  <integer>${value}</integer>`)
    .join("\n");
  return `${pad}<dict>\n${keys}\n${pad}</dict>`;
}

function renderSchedule(schedule) {
  if (schedule.length === 1) {
    return `  <key>StartCalendarInterval</key>\n${renderCalendarEntry(schedule[0], 2)}`;
  }
  const entries = schedule.map((entry) => renderCalendarEntry(entry, 4)).join("\n");
  return `  <key>StartCalendarInterval</key>\n  <array>\n${entries}\n  </array>`;
}

export function renderLaunchdPlist(job, { root = REPO_ROOT } = {}) {
  const logDir = `${root}/.agents/results/kpi`;
  const argv = [`${root}/scripts/launchd/run-cron.sh`, job.script, ...job.args];
  const args = argv.map((value) => `    <string>${xmlEscape(value)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL_PREFIX}.${job.name}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
${args}
  </array>
${renderSchedule(job.schedule)}
  <key>StandardOutPath</key>
  <string>${logDir}/${job.name}.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/${job.name}.launchd.err.log</string>
</dict>
</plist>
`;
}

export function renderLaunchdPlists({ root = REPO_ROOT } = {}) {
  return LAUNCHD_JOBS.map((job) => ({
    label: `${LABEL_PREFIX}.${job.name}`,
    fileName: `${LABEL_PREFIX}.${job.name}.plist`,
    contents: renderLaunchdPlist(job, { root }),
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out-dir");
  const rendered = renderLaunchdPlists();
  if (args.includes("--check") || outIndex === -1) {
    for (const job of LAUNCHD_JOBS) {
      process.stdout.write(`${LABEL_PREFIX}.${job.name}  ${JSON.stringify(job.schedule)}\n`);
    }
    process.stdout.write(`\n${rendered.length} jobs; pass --out-dir <dir> to write them\n`);
  } else {
    const outDir = resolve(args[outIndex + 1] ?? ".");
    mkdirSync(outDir, { recursive: true });
    for (const { fileName, contents } of rendered) {
      writeFileSync(join(outDir, fileName), contents);
      process.stdout.write(`wrote ${join(outDir, fileName)}\n`);
    }
  }
}
