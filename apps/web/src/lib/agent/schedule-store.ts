import { computeNextRun } from "./schedule-logic";
import type { Schedule } from "./types";

/** In-memory schedule store (globalThis singleton, HMR-safe). */
export class ScheduleStore {
  private items = new Map<string, Schedule>();

  create(input: { playbookId: string; intervalMinutes: number; enabled?: boolean; nowMs?: number }): Schedule {
    const nowMs = input.nowMs ?? Date.now();
    const schedule: Schedule = {
      id: crypto.randomUUID(),
      playbookId: input.playbookId,
      intervalMinutes: input.intervalMinutes,
      enabled: input.enabled ?? true,
      nextRunAt: computeNextRun(nowMs, input.intervalMinutes),
      createdAt: new Date(nowMs).toISOString(),
    };
    this.items.set(schedule.id, schedule);
    return schedule;
  }

  get(id: string): Schedule | undefined {
    return this.items.get(id);
  }

  list(): Schedule[] {
    return [...this.items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  update(id: string, patch: Partial<Pick<Schedule, "enabled" | "intervalMinutes">>): Schedule | undefined {
    const s = this.items.get(id);
    if (!s) return undefined;
    if (typeof patch.enabled === "boolean") s.enabled = patch.enabled;
    if (typeof patch.intervalMinutes === "number" && patch.intervalMinutes > 0) {
      s.intervalMinutes = patch.intervalMinutes;
    }
    return s;
  }

  /** Mark a schedule as just-run, advancing nextRunAt by its interval. */
  markRan(id: string, nowMs = Date.now()): void {
    const s = this.items.get(id);
    if (!s) return;
    s.lastRunAt = new Date(nowMs).toISOString();
    s.nextRunAt = computeNextRun(nowMs, s.intervalMinutes);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }
}

type GlobalWithStore = typeof globalThis & { __sangforScheduleStore?: ScheduleStore };

export const scheduleStore: ScheduleStore = (() => {
  const g = globalThis as GlobalWithStore;
  g.__sangforScheduleStore ??= new ScheduleStore();
  return g.__sangforScheduleStore;
})();
