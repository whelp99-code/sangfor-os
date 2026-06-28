import { describe, expect, it } from "vitest";

import { AgentRunStore } from "./run-store";

describe("AgentRunStore", () => {
  it("creates a running record and lists it", () => {
    const store = new AgentRunStore();
    const r = store.create({ goal: "do x", allowUnsafe: false });
    expect(r.status).toBe("running");
    expect(r.id).toBeTruthy();
    expect(store.list()).toHaveLength(1);
    expect(store.get(r.id)?.goal).toBe("do x");
  });

  it("appends steps and finalizes", () => {
    const store = new AgentRunStore();
    const r = store.create({ goal: "g", allowUnsafe: false });
    store.appendStep(r.id, { index: 0, kind: "tool", tool: "t", observation: { ok: 1 } });
    store.finish(r.id, { status: "completed", answer: "done" });
    const got = store.get(r.id)!;
    expect(got.steps).toHaveLength(1);
    expect(got.status).toBe("completed");
    expect(got.answer).toBe("done");
    expect(got.finishedAt).toBeTruthy();
  });

  it("records blocked + error metadata", () => {
    const store = new AgentRunStore();
    const r = store.create({ goal: "g", allowUnsafe: false });
    store.finish(r.id, { status: "blocked", blockedTool: "sangfor.apply", blockedArguments: { a: 1 } });
    const got = store.get(r.id)!;
    expect(got.status).toBe("blocked");
    expect(got.blockedTool).toBe("sangfor.apply");
  });

  it("lists most-recent first and caps history", () => {
    const store = new AgentRunStore();
    for (let i = 0; i < 120; i++) store.create({ goal: `g${i}`, allowUnsafe: false });
    const list = store.list(5);
    expect(list).toHaveLength(5);
    expect(list[0].goal).toBe("g119");
    // oldest evicted beyond MAX_HISTORY (100)
    expect(store.list(1000).length).toBeLessThanOrEqual(100);
  });
});
