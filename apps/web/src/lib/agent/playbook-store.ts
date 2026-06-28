import type { Playbook } from "./types";

/** In-memory playbook store (globalThis singleton, HMR-safe). */
export class PlaybookStore {
  private items = new Map<string, Playbook>();

  constructor(seed: Array<Omit<Playbook, "id" | "createdAt">> = []) {
    for (const s of seed) this.create(s);
  }

  create(input: { name: string; goal: string; allowUnsafe?: boolean; maxSteps?: number }): Playbook {
    const playbook: Playbook = {
      id: crypto.randomUUID(),
      name: input.name,
      goal: input.goal,
      allowUnsafe: input.allowUnsafe ?? false,
      maxSteps: input.maxSteps,
      createdAt: new Date().toISOString(),
    };
    this.items.set(playbook.id, playbook);
    return playbook;
  }

  get(id: string): Playbook | undefined {
    return this.items.get(id);
  }

  list(): Playbook[] {
    return [...this.items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }
}

const SEED: Array<Omit<Playbook, "id" | "createdAt">> = [
  {
    name: "제품 카탈로그 요약",
    goal: "사용 가능한 Sangfor 제품 목록을 조회하고 한국어로 핵심을 요약하라.",
    allowUnsafe: false,
  },
  {
    name: "NGAF 매뉴얼 검색",
    goal: "NGAF 방화벽 정책 설정 매뉴얼을 검색해 핵심 설정 단계를 정리하라.",
    allowUnsafe: false,
  },
];

type GlobalWithStore = typeof globalThis & { __sangforPlaybookStore?: PlaybookStore };

export const playbookStore: PlaybookStore = (() => {
  const g = globalThis as GlobalWithStore;
  g.__sangforPlaybookStore ??= new PlaybookStore(SEED);
  return g.__sangforPlaybookStore;
})();
