import { describe, expect, it, beforeEach, vi } from "vitest";

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));
vi.mock("@sangfor/agent", () => ({ runConfigAutomation: mockRun }));

import { POST } from "./route";
import { workflowRunStore } from "@/lib/agent/workflow-run-store";

function req(body: unknown, raw = false) {
  return new Request("http://localhost/api/agent/workflow/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => mockRun.mockReset());

describe("POST /api/agent/workflow/run", () => {
  it("rejects missing requirements", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("streams stage events and persists a blocked (awaiting approval) run", async () => {
    mockRun.mockImplementation(async (input?: { onStage?: (s: unknown) => void }) => {
      input?.onStage?.({ id: "analyze", title: "분석", kind: "service", status: "completed", output: {} });
      input?.onStage?.({ id: "approval", title: "승인", kind: "approval", status: "blocked" });
      return { id: "config-automation", title: "T", status: "blocked", stages: [], awaitingApproval: "approval" };
    });

    const res = await POST(req({ requirements: "branch office NGAF" }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: run");
    expect(text).toContain("event: stage");
    expect(text).toContain("event: done");
    expect(text).toContain("awaitingApproval");

    const latest = workflowRunStore.list(1)[0];
    expect(latest.requirements).toBe("branch office NGAF");
    expect(latest.status).toBe("blocked");
    expect(latest.stages).toHaveLength(2);
  });

  it("passes approvals through to the runner", async () => {
    mockRun.mockResolvedValue({ id: "x", title: "T", status: "completed", stages: [] });
    await POST(req({ requirements: "x", approvals: ["approval"] }));
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ approvals: ["approval"] }));
  });

  it("emits an error event when the workflow throws", async () => {
    mockRun
      .mockRejectedValueOnce(new Error("console down"))
      .mockResolvedValue({ id: "x", title: "T", status: "completed", stages: [] });
    const res = await POST(req({ requirements: "x" }));
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("console down");
  });
});
