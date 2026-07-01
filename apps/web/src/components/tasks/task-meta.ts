// Client-safe task presentation + state-machine helpers.
// Mirrors the canonical state machine in @sangfor/business/task-center
// (TASK_NEXT_STATUS). Kept as a plain TS module so client components can
// import it without pulling the server-only business/prisma bundle.

export const TASK_STATUSES = ["todo", "doing", "waiting", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Forward flow: todo -> doing -> done. `waiting` rejoins at `doing`. */
export const TASK_NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  todo: "doing",
  doing: "done",
  waiting: "doing",
  done: null,
};

export function nextTaskStatus(status: string): TaskStatus | null {
  return TASK_NEXT_STATUS[status as TaskStatus] ?? null;
}

/** ko display labels for task statuses. Keys stay English (state-machine SSOT). */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "할 일",
  doing: "진행 중",
  waiting: "대기",
  done: "완료",
};

export function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABELS[status as TaskStatus] ?? status;
}

export const PRIORITY_OPTIONS = [
  { value: "low", label: "낮음" },
  { value: "normal", label: "보통" },
  { value: "high", label: "높음" },
  { value: "urgent", label: "긴급" },
] as const;

/** Format a dueAt value (Date | ISO string | null) as a short ko date label. */
export function formatDueAt(dueAt: string | Date | null | undefined): string | null {
  if (!dueAt) return null;
  const d = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
