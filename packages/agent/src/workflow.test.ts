import { describe, expect, it, vi } from "vitest";

import { buildConfigAutomationWorkflow, runWorkflow } from "./workflow";
import type { LlmComplete } from "./types";

describe("runWorkflow", () => {
  it("runs stages sequentially, passing outputs forward", async () => {
    const seen: Record<string, unknown> = {};
    const res = await runWorkflow({
      id: "wf",
      title: "T",
      stages: [
        { id: "a", title: "A", kind: "service", execute: async () => ({ n: 1 }) },
        {
          id: "b",
          title: "B",
          kind: "agent",
          execute: async (ctx) => {
            seen.a = ctx.outputs.a;
            return { n: 2 };
          },
        },
      ],
    });
    expect(res.status).toBe("completed");
    expect(res.stages.map((s) => s.id)).toEqual(["a", "b"]);
    expect(seen.a).toEqual({ n: 1 });
    expect(res.stages[1].output).toEqual({ n: 2 });
  });

  it("blocks at an unapproved approval gate and does not run later stages", async () => {
    const apply = vi.fn(async () => ({ applied: true }));
    const res = await runWorkflow({
      id: "wf",
      title: "T",
      stages: [
        { id: "plan", title: "Plan", kind: "service", execute: async () => ({ ok: true }) },
        { id: "approval", title: "Approve", kind: "approval" },
        { id: "apply", title: "Apply", kind: "service", execute: apply },
      ],
    });
    expect(res.status).toBe("blocked");
    expect(res.awaitingApproval).toBe("approval");
    expect(apply).not.toHaveBeenCalled();
  });

  it("proceeds through an approved gate", async () => {
    const apply = vi.fn(async () => ({ applied: true }));
    const res = await runWorkflow({
      id: "wf",
      title: "T",
      approvals: ["approval"],
      stages: [
        { id: "approval", title: "Approve", kind: "approval" },
        { id: "apply", title: "Apply", kind: "service", execute: apply },
      ],
    });
    expect(res.status).toBe("completed");
    expect(apply).toHaveBeenCalled();
  });

  it("stops with error status when a stage throws", async () => {
    const res = await runWorkflow({
      id: "wf",
      title: "T",
      stages: [
        { id: "a", title: "A", kind: "service", execute: async () => { throw new Error("svc down"); } },
        { id: "b", title: "B", kind: "service", execute: async () => ({ n: 2 }) },
      ],
    });
    expect(res.status).toBe("error");
    expect(res.stages).toHaveLength(1);
    expect(res.stages[0].error).toContain("svc down");
  });
});

describe("buildConfigAutomationWorkflow", () => {
  const deps = {
    analyzeProject: vi.fn(async () => ({ findings: ["needs NGAF"] })),
    generateConfigPlan: vi.fn(async () => ({ steps: ["enable policy"] })),
    llm: (vi.fn(async () =>
      '{"risk":"low","issues":[],"summary":"looks fine"}',
    ) as unknown) as LlmComplete,
  };

  it("chains analyze → plan → verify, then blocks at approval before apply", async () => {
    const { id, title, stages } = buildConfigAutomationWorkflow({ requirements: "branch office", deps });
    const res = await runWorkflow({ id, title, stages });

    expect(res.status).toBe("blocked");
    expect(res.awaitingApproval).toBe("approval");
    expect(deps.analyzeProject).toHaveBeenCalled();
    expect(deps.generateConfigPlan).toHaveBeenCalledWith({
      requirements: "branch office",
      analysis: { findings: ["needs NGAF"] },
    });
    const verify = res.stages.find((s) => s.id === "verify");
    expect(verify?.output).toMatchObject({ risk: "low" });
  });

  it("reaches apply once approval is granted", async () => {
    const { id, title, stages } = buildConfigAutomationWorkflow({ requirements: "branch office", deps });
    const res = await runWorkflow({ id, title, stages, approvals: ["approval"] });
    expect(res.status).toBe("completed");
    expect(res.stages.find((s) => s.id === "apply")?.output).toMatchObject({ applied: false });
  });
});
