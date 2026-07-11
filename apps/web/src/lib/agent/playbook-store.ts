import { prisma } from "@sangfor/db";
import type { Prisma } from "@sangfor/db";

import type { Playbook } from "./types";

function toPlaybook(row: Prisma.AgentPlaybookGetPayload<Record<string, never>>): Playbook {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    description: row.description ?? undefined,
    allowUnsafe: row.allowUnsafe,
    maxSteps: row.maxSteps ?? undefined,
    role: row.role ?? undefined,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

export type PlaybookSeed = Omit<Playbook, "id" | "createdAt" | "enabled"> & { enabled?: boolean };

const DEFAULT_SEED: PlaybookSeed[] = [
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
  {
    name: "영업 브리핑",
    goal: "파이프라인 요약과 임박 리뉴얼 브리핑",
    allowUnsafe: false,
    role: "sales",
  },
  {
    name: "프리세일즈 자료 검색",
    goal: "최근 PoC 관련 매뉴얼/기술자료 검색 요약",
    allowUnsafe: false,
    role: "presales",
  },
  {
    name: "엔지니어 헬스 요약",
    goal: "스토어 헬스와 최근 지원 이슈 요약",
    allowUnsafe: false,
    role: "engineer",
  },
  {
    name: "CFO 재무 하이라이트",
    goal: "이번 달 재무 하이라이트 요약",
    allowUnsafe: false,
    role: "cfo",
  },
];

/** DB-backed playbook store (Prisma `agent_playbooks`). Seeds idempotently (by name) on first access. */
export class PlaybookStore {
  private seeded?: Promise<void>;

  constructor(private readonly seed: PlaybookSeed[] = DEFAULT_SEED) {}

  private ensureSeeded(): Promise<void> {
    this.seeded ??= this.runSeed();
    return this.seeded;
  }

  private async runSeed(): Promise<void> {
    for (const s of this.seed) {
      // upsert (not findFirst+create): concurrent cold-start requests must not
      // race past a check-then-insert and double-create the same seed row.
      await prisma.agentPlaybook.upsert({
        where: { name: s.name },
        update: {},
        create: {
          name: s.name,
          goal: s.goal,
          description: s.description,
          allowUnsafe: s.allowUnsafe,
          maxSteps: s.maxSteps,
          role: s.role,
          enabled: s.enabled ?? true,
        },
      });
    }
  }

  async create(input: {
    name: string;
    goal: string;
    description?: string;
    allowUnsafe?: boolean;
    maxSteps?: number;
    role?: string;
    enabled?: boolean;
  }): Promise<Playbook> {
    await this.ensureSeeded();
    const row = await prisma.agentPlaybook.create({
      data: {
        name: input.name,
        goal: input.goal,
        description: input.description,
        allowUnsafe: input.allowUnsafe ?? false,
        maxSteps: input.maxSteps,
        role: input.role,
        enabled: input.enabled ?? true,
      },
    });
    return toPlaybook(row);
  }

  async get(id: string): Promise<Playbook | undefined> {
    await this.ensureSeeded();
    const row = await prisma.agentPlaybook.findUnique({ where: { id } });
    return row ? toPlaybook(row) : undefined;
  }

  async list(): Promise<Playbook[]> {
    await this.ensureSeeded();
    const rows = await prisma.agentPlaybook.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toPlaybook);
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureSeeded();
    try {
      await prisma.agentPlaybook.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

type GlobalWithStore = typeof globalThis & { __sangforPlaybookStore?: PlaybookStore };

export const playbookStore: PlaybookStore = (() => {
  const g = globalThis as GlobalWithStore;
  g.__sangforPlaybookStore ??= new PlaybookStore();
  return g.__sangforPlaybookStore;
})();
