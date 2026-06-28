import { describe, expect, it } from "vitest";

import { computeNextRun, dueSchedules, isDue } from "./schedule-logic";
import { ScheduleStore } from "./schedule-store";
import type { Schedule } from "./types";

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0); // fixed clock

function sched(over: Partial<Schedule>): Schedule {
  return {
    id: "s",
    playbookId: "p",
    intervalMinutes: 60,
    enabled: true,
    nextRunAt: new Date(T0).toISOString(),
    createdAt: new Date(T0).toISOString(),
    ...over,
  };
}

describe("schedule-logic", () => {
  it("computeNextRun advances by interval", () => {
    expect(computeNextRun(T0, 30)).toBe(new Date(T0 + 30 * 60_000).toISOString());
  });

  it("isDue respects enabled flag and nextRunAt", () => {
    expect(isDue(sched({ nextRunAt: new Date(T0).toISOString() }), T0)).toBe(true);
    expect(isDue(sched({ nextRunAt: new Date(T0 + 1000).toISOString() }), T0)).toBe(false);
    expect(isDue(sched({ enabled: false }), T0 + 1_000_000)).toBe(false);
  });

  it("dueSchedules filters the due ones", () => {
    const a = sched({ id: "a", nextRunAt: new Date(T0 - 1000).toISOString() });
    const b = sched({ id: "b", nextRunAt: new Date(T0 + 10_000).toISOString() });
    expect(dueSchedules([a, b], T0).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("ScheduleStore", () => {
  it("creates with nextRunAt = now + interval", () => {
    const store = new ScheduleStore();
    const s = store.create({ playbookId: "p", intervalMinutes: 15, nowMs: T0 });
    expect(s.nextRunAt).toBe(new Date(T0 + 15 * 60_000).toISOString());
    expect(s.enabled).toBe(true);
  });

  it("markRan advances nextRunAt and sets lastRunAt", () => {
    const store = new ScheduleStore();
    const s = store.create({ playbookId: "p", intervalMinutes: 10, nowMs: T0 });
    store.markRan(s.id, T0 + 10 * 60_000);
    const got = store.get(s.id)!;
    expect(got.lastRunAt).toBe(new Date(T0 + 10 * 60_000).toISOString());
    expect(got.nextRunAt).toBe(new Date(T0 + 20 * 60_000).toISOString());
  });

  it("update toggles enabled and interval; remove deletes", () => {
    const store = new ScheduleStore();
    const s = store.create({ playbookId: "p", intervalMinutes: 10, nowMs: T0 });
    store.update(s.id, { enabled: false, intervalMinutes: 30 });
    expect(store.get(s.id)?.enabled).toBe(false);
    expect(store.get(s.id)?.intervalMinutes).toBe(30);
    expect(store.remove(s.id)).toBe(true);
    expect(store.get(s.id)).toBeUndefined();
  });
});
