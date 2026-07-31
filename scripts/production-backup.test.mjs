import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_KEEP_DAYS,
  DEFAULT_KEEP_MIN,
  MIN_PLAUSIBLE_BYTES,
  selectForPruning,
} from "./production-backup.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 31, 3, 10, 0);

/** `count` backups, one per day going back from yesterday. */
function daily(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `scheduled-day-${index + 1}.dump`,
    mtimeMs: NOW - (index + 1) * DAY,
  }));
}

describe("selectForPruning", () => {
  it("keeps everything inside the retention window", () => {
    const prune = selectForPruning(daily(10), { now: NOW, keepDays: 14, keepMin: 5 });
    assert.deepEqual(prune, []);
  });

  it("prunes what is older than the window", () => {
    const backups = [...daily(5), { name: "ancient.dump", mtimeMs: NOW - 30 * DAY }];
    assert.deepEqual(selectForPruning(backups, { now: NOW, keepDays: 14, keepMin: 5 }), ["ancient.dump"]);
  });

  it("never prunes below keepMin, however old they all are", () => {
    // An empty backup directory is worse than a stale one.
    const ancient = Array.from({ length: 4 }, (_, i) => ({
      name: `old-${i}.dump`,
      mtimeMs: NOW - (100 + i) * DAY,
    }));
    assert.deepEqual(selectForPruning(ancient, { now: NOW, keepDays: 14, keepMin: 5 }), []);
  });

  it("keeps the newest when it has to choose", () => {
    const backups = [
      { name: "newest.dump", mtimeMs: NOW - 100 * DAY },
      { name: "middle.dump", mtimeMs: NOW - 200 * DAY },
      { name: "oldest.dump", mtimeMs: NOW - 300 * DAY },
    ];
    // keepMin 2 leaves the two newest and prunes only the oldest.
    assert.deepEqual(selectForPruning(backups, { now: NOW, keepDays: 1, keepMin: 2 }), ["oldest.dump"]);
  });

  it("is order-independent — the caller's listing order must not matter", () => {
    const backups = [
      { name: "b.dump", mtimeMs: NOW - 50 * DAY },
      { name: "a.dump", mtimeMs: NOW - 1 * DAY },
      { name: "c.dump", mtimeMs: NOW - 60 * DAY },
    ];
    const forward = selectForPruning(backups, { now: NOW, keepDays: 14, keepMin: 1 });
    const reversed = selectForPruning([...backups].reverse(), { now: NOW, keepDays: 14, keepMin: 1 });
    assert.deepEqual(forward.sort(), reversed.sort());
    assert.deepEqual(forward.sort(), ["b.dump", "c.dump"]);
  });

  it("handles an empty directory without throwing", () => {
    assert.deepEqual(selectForPruning([], { now: NOW }), []);
  });

  it("uses a retention window and floor that leave room for a weekly cadence", () => {
    // The watchdog calls a backup stale after 26h; the window has to be wide
    // enough that a few missed days do not empty the directory.
    assert.ok(DEFAULT_KEEP_DAYS >= 7);
    assert.ok(DEFAULT_KEEP_MIN >= 3);
    // Any real dump of this database is far larger than the plausibility floor.
    assert.ok(MIN_PLAUSIBLE_BYTES >= 128 * 1024);
  });
});
