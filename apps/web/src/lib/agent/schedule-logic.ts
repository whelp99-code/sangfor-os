import type { Schedule } from "./types";

/** Compute the next run timestamp `intervalMinutes` after `fromMs`. */
export function computeNextRun(fromMs: number, intervalMinutes: number): string {
  return new Date(fromMs + intervalMinutes * 60_000).toISOString();
}

/** A schedule is due when enabled and its nextRunAt has passed. */
export function isDue(schedule: Schedule, nowMs: number): boolean {
  return schedule.enabled && Date.parse(schedule.nextRunAt) <= nowMs;
}

/** All schedules that are due to run at `nowMs`. */
export function dueSchedules(schedules: Schedule[], nowMs: number): Schedule[] {
  return schedules.filter((s) => isDue(s, nowMs));
}
