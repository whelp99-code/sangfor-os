import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKUP_STALE_MS,
  EXPECTED_CONTAINERS,
  EXPECTED_JOBS,
  MAIL_SYNC_STALE_MS,
  evaluateHealth,
  formatFindings,
} from "./production-watchdog.mjs";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

/** A stack with nothing wrong with it. */
function healthy(overrides = {}) {
  return {
    now: NOW,
    containers: EXPECTED_CONTAINERS.map((name) => ({
      name,
      running: true,
      state: "running",
      // Caddy declares no healthcheck in the compose file.
      health: name === "caddy" ? "none" : "healthy",
    })),
    jobs: EXPECTED_JOBS.map((name) => ({ name, lastExitCode: 0, loaded: true })),
    ingress: { status: 200 },
    backup: { latestMtimeMs: NOW - 60 * 60 * 1000 },
    mailAccount: { lastSyncedAtMs: NOW - 10 * 60 * 1000 },
    ...overrides,
  };
}

const subjects = (verdict) => verdict.findings.map((f) => f.subject);

describe("evaluateHealth", () => {
  it("passes a stack where every part is up", () => {
    const verdict = evaluateHealth(healthy());
    assert.deepEqual(verdict.findings, []);
    assert.equal(verdict.ok, true);
  });

  it("does not fault Caddy for declaring no healthcheck", () => {
    // Only caddy has no healthcheck; treating "none" as a failure would page on
    // every single run.
    const verdict = evaluateHealth(healthy());
    assert.ok(!subjects(verdict).includes("container/caddy"));
  });

  it("reports a stopped container as critical", () => {
    const snapshot = healthy();
    snapshot.containers = snapshot.containers.map((c) =>
      c.name === "web" ? { ...c, running: false, state: "exited" } : c);
    const verdict = evaluateHealth(snapshot);
    assert.equal(verdict.ok, false);
    const finding = verdict.findings.find((f) => f.subject === "container/web");
    assert.equal(finding.severity, "critical");
    assert.match(finding.detail, /exited/u);
  });

  it("reports an unhealthy container even while it is running", () => {
    const snapshot = healthy();
    snapshot.containers = snapshot.containers.map((c) =>
      c.name === "api" ? { ...c, health: "unhealthy" } : c);
    assert.equal(evaluateHealth(snapshot).findings[0].subject, "container/api");
  });

  it("reports a container that is absent entirely", () => {
    const snapshot = healthy();
    snapshot.containers = snapshot.containers.filter((c) => c.name !== "postgres");
    const finding = evaluateHealth(snapshot).findings.find((f) => f.subject === "container/postgres");
    assert.equal(finding.severity, "critical");
    assert.match(finding.detail, /not present/u);
  });

  it("treats an unreachable ingress as critical, including no response at all", () => {
    for (const status of [502, 401, null]) {
      const verdict = evaluateHealth(healthy({ ingress: { status } }));
      const finding = verdict.findings.find((f) => f.subject === "ingress");
      assert.equal(finding.severity, "critical", `status ${status}`);
    }
  });

  it("reports a job whose last run failed, and names it", () => {
    const snapshot = healthy();
    snapshot.jobs = snapshot.jobs.map((j) => j.name === "mail-learn" ? { ...j, lastExitCode: 65 } : j);
    const finding = evaluateHealth(snapshot).findings.find((f) => f.subject === "job/mail-learn");
    assert.equal(finding.severity, "warning");
    assert.match(finding.detail, /65/u);
  });

  it("reports a job that is not loaded at all", () => {
    const snapshot = healthy();
    snapshot.jobs = snapshot.jobs.filter((j) => j.name !== "autopilot");
    const finding = evaluateHealth(snapshot).findings.find((f) => f.subject === "job/autopilot");
    assert.equal(finding.severity, "critical");
  });

  it("notices when mail stops landing", () => {
    // Sync runs twice an hour; silence well past that means it stopped.
    const stale = healthy({ mailAccount: { lastSyncedAtMs: NOW - MAIL_SYNC_STALE_MS - 60_000 } });
    assert.ok(subjects(evaluateHealth(stale)).includes("mail-sync"));

    const fresh = healthy({ mailAccount: { lastSyncedAtMs: NOW - MAIL_SYNC_STALE_MS + 60_000 } });
    assert.ok(!subjects(evaluateHealth(fresh)).includes("mail-sync"));
  });

  it("notices a mailbox that has never synced", () => {
    const verdict = evaluateHealth(healthy({ mailAccount: { lastSyncedAtMs: null } }));
    assert.match(verdict.findings.find((f) => f.subject === "mail-sync").detail, /has ever synced/u);
  });

  it("treats a stale or missing backup as critical, not a warning", () => {
    // An unbacked-up window is a data-loss window; today's mail sat in one.
    const stale = evaluateHealth(healthy({ backup: { latestMtimeMs: NOW - BACKUP_STALE_MS - 60_000 } }));
    assert.equal(stale.findings.find((f) => f.subject === "backup").severity, "critical");

    const missing = evaluateHealth(healthy({ backup: { latestMtimeMs: null } }));
    assert.match(missing.findings.find((f) => f.subject === "backup").detail, /no backup/u);
  });

  it("collects every independent finding rather than stopping at the first", () => {
    const snapshot = healthy({ ingress: { status: 502 }, backup: { latestMtimeMs: null } });
    snapshot.jobs = snapshot.jobs.map((j) => ({ ...j, lastExitCode: 1 }));
    const verdict = evaluateHealth(snapshot);
    assert.equal(verdict.findings.length, 2 + EXPECTED_JOBS.length);
  });
});

describe("formatFindings", () => {
  it("says so plainly when there is nothing wrong", () => {
    assert.match(formatFindings([]), /healthy/u);
  });

  it("leads with CRITICAL when any finding is critical", () => {
    const text = formatFindings([
      { severity: "warning", subject: "job/autopilot", detail: "last exit 1" },
      { severity: "critical", subject: "ingress", detail: "no response" },
    ]);
    assert.match(text, /^CRITICAL/u);
    assert.match(text, /job\/autopilot/u);
    assert.match(text, /ingress/u);
  });

  it("leads with WARNING when nothing is critical", () => {
    assert.match(
      formatFindings([{ severity: "warning", subject: "mail-sync", detail: "last sync 200 min ago" }]),
      /^WARNING/u,
    );
  });
});
