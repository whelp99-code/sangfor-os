import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LAUNCHD_JOBS, renderLaunchdPlist, renderLaunchdPlists } from "./render-launchd-plists.mjs";

const ROOT = "/srv/sangfor-os";

function jobNamed(name) {
  const job = LAUNCHD_JOBS.find((entry) => entry.name === name);
  assert.ok(job, `no such job: ${name}`);
  return job;
}

describe("renderLaunchdPlists", () => {
  it("drives every job through run-cron.sh rather than a raw localhost call", () => {
    // The hand-maintained copies called http://localhost:3101, which the
    // production compose never publishes — every job failed with curl exit 7.
    const rendered = renderLaunchdPlists({ root: ROOT });
    assert.equal(rendered.length, LAUNCHD_JOBS.length);
    for (const { contents } of rendered) {
      assert.ok(contents.includes(`${ROOT}/scripts/launchd/run-cron.sh`));
      assert.ok(!contents.includes("localhost:3101"));
    }
  });

  it("writes absolute log paths under the given root", () => {
    const plist = renderLaunchdPlist(jobNamed("mail-sync"), { root: ROOT });
    assert.ok(plist.includes(`${ROOT}/.agents/results/kpi/mail-sync.launchd.log`));
    assert.ok(plist.includes(`${ROOT}/.agents/results/kpi/mail-sync.launchd.err.log`));
  });

  it("renders a lone schedule entry as a dict and several as an array", () => {
    assert.match(
      renderLaunchdPlist(jobNamed("mail-classify"), { root: ROOT }),
      /<key>StartCalendarInterval<\/key>\s*<dict>/u,
    );
    assert.match(
      renderLaunchdPlist(jobNamed("mail-sync"), { root: ROOT }),
      /<key>StartCalendarInterval<\/key>\s*<array>/u,
    );
  });

  it("escapes XML metacharacters in arguments", () => {
    // daily-briefing carries a query string; an unescaped & is invalid plist XML.
    const plist = renderLaunchdPlist(jobNamed("daily-briefing"), { root: ROOT });
    assert.ok(plist.includes("brief=1"));
    assert.doesNotMatch(plist, /&(?!amp;|lt;|gt;)/u);
  });

  it("orders the mail pipeline so learning runs between sync and classification", () => {
    // mail-candidates reads mail_insight_threads, which only mail-learn writes.
    // Classifying before learning left 1329 synced messages producing nothing.
    const firstMinute = (name) => jobNamed(name).schedule[0].Minute;
    assert.ok(firstMinute("mail-sync") < firstMinute("mail-learn"));
    assert.ok(firstMinute("mail-learn") < firstMinute("mail-classify"));
  });

  it("labels every job under the shared prefix and names one file each", () => {
    for (const { label, fileName } of renderLaunchdPlists({ root: ROOT })) {
      assert.match(label, /^com\.jmpark\.sangfor\.[a-z-]+$/u);
      assert.equal(fileName, `${label}.plist`);
    }
  });

  it("keeps the rendered job set in step with the installed schedule contract", () => {
    // A job added to LAUNCHD_JOBS without a schedule would install as a plist
    // launchd accepts but never fires.
    for (const job of LAUNCHD_JOBS) {
      assert.ok(Array.isArray(job.schedule) && job.schedule.length > 0, `${job.name} has no schedule`);
      for (const entry of job.schedule) {
        assert.ok(Number.isInteger(entry.Minute), `${job.name} schedule entry lacks Minute`);
        assert.ok(entry.Minute >= 0 && entry.Minute <= 59, `${job.name} Minute out of range`);
      }
      assert.ok(job.args.includes("--path"), `${job.name} does not target an endpoint`);
    }
  });
});
