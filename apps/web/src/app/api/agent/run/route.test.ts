import { afterAll, beforeAll, describe, expect, it, beforeEach, vi } from "vitest";

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));
vi.mock("@sangfor/agent", () => ({ runMcpAgent: mockRun }));

import { POST } from "./route";
import { agentRunStore } from "@/lib/agent/run-store";

function req(body: unknown, raw = false) {
  return new Request("http://localhost/api/agent/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => mockRun.mockReset());

// The run route is now guarded by assertApiAccess; enable the dev/demo bypass
// so these behavioral tests exercise the handler rather than the 401 path.
const prevBypass = process.env.AUTH_BYPASS_ENABLED;
beforeAll(() => {
  process.env.AUTH_BYPASS_ENABLED = "1";
});
afterAll(() => {
  process.env.AUTH_BYPASS_ENABLED = prevBypass;
});

describe("POST /api/agent/run", () => {
  it("rejects a missing goal", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(req("{bad", true));
    expect(res.status).toBe(400);
  });

  it("streams run/step/done events and persists the run", async () => {
    // Guard against a known vitest/undici quirk where the stream's start() body
    // can invoke the mock an extra time with no args after completion.
    mockRun.mockImplementation(async (input?: { onStep?: (s: unknown) => void }) => {
      input?.onStep?.({ index: 0, kind: "tool", tool: "sangfor.products", observation: { ok: 1 } });
      return { goal: "g", status: "completed", answer: "done", steps: [] };
    });

    const res = await POST(req({ goal: "list products" }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: run");
    expect(text).toContain("event: step");
    expect(text).toContain("event: done");
    expect(text).toContain("sangfor.products");

    const latest = agentRunStore.list(1)[0];
    expect(latest.goal).toBe("list products");
    expect(latest.status).toBe("completed");
    expect(latest.steps).toHaveLength(1);
  });

  it("emits an error event when the agent throws", async () => {
    // Reject the real (first) invocation; a spurious second invocation resolves
    // harmlessly so no unhandled rejection leaks into the test runner.
    mockRun
      .mockRejectedValueOnce(new Error("bridge down"))
      .mockResolvedValue({ goal: "x", status: "completed", steps: [] });
    const res = await POST(req({ goal: "x" }));
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("bridge down");
    expect(agentRunStore.list(1)[0].status).toBe("error");
  });
});
