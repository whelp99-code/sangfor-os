import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));
vi.mock("@sangfor/agent", () => ({ runMcpAgent: mockRun }));

import { POST } from "./route";
import { playbookStore } from "@/lib/agent/playbook-store";
import { scheduleStore } from "@/lib/agent/schedule-store";

// The tick route is now guarded by assertApiAccess; enable the dev/demo bypass
// so these behavioral tests exercise the handler rather than the 401 path.
const tickRequest = () => new Request("http://test/api/agent/schedules/tick", { method: "POST" });

describe("POST /api/agent/schedules/tick", () => {
  const prevBypass = process.env.AUTH_BYPASS_ENABLED;
  beforeAll(() => {
    process.env.AUTH_BYPASS_ENABLED = "1";
  });
  afterAll(() => {
    process.env.AUTH_BYPASS_ENABLED = prevBypass;
  });

  it("runs due schedules, records a run, and advances nextRunAt", async () => {
    mockRun.mockResolvedValue({ goal: "g", status: "completed", answer: "ok", steps: [] });

    const pb = playbookStore.create({ name: "tickP", goal: "do tick" });
    // created 10 min ago with a 5 min interval → nextRunAt is in the past (due).
    const past = Date.now() - 10 * 60_000;
    const s = scheduleStore.create({ playbookId: pb.id, intervalMinutes: 5, nowMs: past });
    const dueBefore = s.nextRunAt;

    const res = await POST(tickRequest());
    const body = await res.json();

    const triggeredIds = body.triggered.map((t: { scheduleId: string }) => t.scheduleId);
    expect(triggeredIds).toContain(s.id);
    expect(mockRun).toHaveBeenCalled();
    // nextRunAt advanced past the previous value
    expect(Date.parse(scheduleStore.get(s.id)!.nextRunAt)).toBeGreaterThan(Date.parse(dueBefore));
    expect(scheduleStore.get(s.id)!.lastRunAt).toBeTruthy();
  });

  it("skips disabled schedules", async () => {
    mockRun.mockClear();
    const pb = playbookStore.create({ name: "offP", goal: "x" });
    const s = scheduleStore.create({ playbookId: pb.id, intervalMinutes: 5, nowMs: Date.now() - 10 * 60_000 });
    scheduleStore.update(s.id, { enabled: false });

    const res = await POST(tickRequest());
    const body = await res.json();
    expect(body.triggered.map((t: { scheduleId: string }) => t.scheduleId)).not.toContain(s.id);
  });
});
