import { prisma } from "@sangfor/db";
import { afterEach, describe, expect, it } from "vitest";

import { PlaybookStore } from "./playbook-store";

describe.skipIf(process.env.CI_INTEGRATION !== "1")("PlaybookStore", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length === 0) return;
    await prisma.agentPlaybook.deleteMany({ where: { id: { in: createdIds.splice(0) } } });
  });

  it("creates, lists, gets and removes playbooks", async () => {
    const store = new PlaybookStore([]);
    const p = await store.create({ name: `P1-${Date.now()}`, goal: "do x" });
    createdIds.push(p.id);
    expect(p.allowUnsafe).toBe(false);
    expect(p.enabled).toBe(true);
    expect((await store.get(p.id))?.name).toBe(p.name);
    expect((await store.list()).map((x) => x.id)).toContain(p.id);
    expect(await store.remove(p.id)).toBe(true);
    expect(await store.get(p.id)).toBeUndefined();
    createdIds.pop();
  });

  it("applies seed entries once, keyed by name (idempotent across instances)", async () => {
    const name = `seed-${Date.now()}`;
    const seed = [{ name, goal: "g", allowUnsafe: false }];
    const first = new PlaybookStore(seed);
    await first.list();
    const second = new PlaybookStore(seed);
    await second.list();

    const rows = await prisma.agentPlaybook.findMany({ where: { name } });
    expect(rows).toHaveLength(1);
    createdIds.push(rows[0]!.id);
  });

  it("seeds the six default (2 read-only + 4 role) playbooks idempotently", async () => {
    const store = new PlaybookStore();
    const list = await store.list();
    const roleNames = list.filter((p) => p.role).map((p) => p.role);
    for (const role of ["sales", "presales", "engineer", "cfo"]) {
      expect(roleNames).toContain(role);
    }
    expect(list.map((p) => p.name)).toEqual(expect.arrayContaining(["제품 카탈로그 요약", "NGAF 매뉴얼 검색"]));

    const store2 = new PlaybookStore();
    const list2 = await store2.list();
    expect(list2.length).toBe(list.length);
  });
});
