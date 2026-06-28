import { describe, expect, it } from "vitest";

import { PlaybookStore } from "./playbook-store";

describe("PlaybookStore", () => {
  it("creates, lists, gets and removes playbooks", () => {
    const store = new PlaybookStore();
    const p = store.create({ name: "P1", goal: "do x" });
    expect(p.allowUnsafe).toBe(false);
    expect(store.get(p.id)?.name).toBe("P1");
    expect(store.list()).toHaveLength(1);
    expect(store.remove(p.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it("applies seed entries", () => {
    const store = new PlaybookStore([{ name: "seed", goal: "g", allowUnsafe: false }]);
    expect(store.list().map((p) => p.name)).toContain("seed");
  });
});
