export const ACTIVITY_NOTE_LABELS: Record<string, string> = {
  "Stage advanced": "단계 진행됨",
  "Opportunity created": "기회 생성됨",
};

export function activityNoteLabel(note: string): string {
  return ACTIVITY_NOTE_LABELS[note] ?? note;
}
