import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockRun, mockClaim } = vi.hoisted(() => ({ mockRun: vi.fn(), mockClaim: vi.fn() }));
vi.mock("@sangfor/agent", () => ({ runMcpAgent: mockRun }));
vi.mock("@sangfor/business", () => ({ claimInternalPrincipalReplay: mockClaim }));

import { POST } from "./route";
import { playbookStore } from "@/lib/agent/playbook-store";
import { scheduleStore } from "@/lib/agent/schedule-store";
import { getInternalPrincipalConfig } from "@sangfor/config";
import { issueInternalPrincipal } from "@sangfor/auth";

// The tick route is now guarded by assertApiAccess; enable the dev/demo bypass
// so these behavioral tests exercise the handler rather than the 401 path.
const tickRequest = () => new Request("http://test/api/agent/schedules/tick", { method: "POST" });
const protocolEnv = () => {
  const timestamp = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const ring = (kid: string, byte: number) => JSON.stringify({ version: "sangfor.internal-principal-keyring/v1", keys: [{ kid, state: "active", secretBase64Url: Buffer.alloc(32, byte).toString("base64url"), activatedAt: timestamp, demotedAt: null, verificationCutoff: null, retiredAt: null }] });
  return {
    INTERNAL_PRINCIPAL_TTL_SECONDS: "60", INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: "5", INTERNAL_PRINCIPAL_ROTATION_OWNER: "security-auth",
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: "finance", INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: ring("finance", 1),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: "scheduler", INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: ring("scheduler", 2),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: "workflow", INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: ring("workflow", 3),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: "engineer", INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: ring("engineer", 4),
  };
};

function schedulerRequest() {
  const now = Math.floor(Date.now() / 1_000);
  const envelope = issueInternalPrincipal({
    profile: "SCHEDULER", subjectType: "service", subjectId: "sangfor-scheduler", sessionId: null,
    tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", businessRole: null,
    capabilities: ["agent.schedule.tick"], method: "POST", path: "/api/agent/schedules/tick", query: "", body: "", idempotencyKey: `tick-${now}`,
  }, getInternalPrincipalConfig(now), { now, randomBytes: () => Buffer.alloc(16, 1) });
  return new Request("http://test/api/agent/schedules/tick", { method: "POST", headers: { "x-sangfor-internal-principal": envelope } });
}

describe("POST /api/agent/schedules/tick", () => {
  const prevBypass = process.env.AUTH_BYPASS_ENABLED;
  const runTag = `test_tick_${Date.now()}`;
  beforeAll(() => {
    process.env.AUTH_BYPASS_ENABLED = "1";
    Object.assign(process.env, protocolEnv());
  });
  afterAll(async () => {
    process.env.AUTH_BYPASS_ENABLED = prevBypass;
    const { prisma } = await import("@sangfor/db");
    await prisma.agentPlaybook.deleteMany({ where: { name: { startsWith: runTag } } });
  });

  it("runs due schedules, records a run, and advances nextRunAt", async () => {
    mockRun.mockResolvedValue({ goal: "g", status: "completed", answer: "ok", steps: [] });

    const pb = await playbookStore.create({ name: `${runTag}_tickP`, goal: "do tick" });
    // created 10 min ago with a 5 min interval → nextRunAt is in the past (due).
    const past = Date.now() - 10 * 60_000;
    const s = scheduleStore.create({ playbookId: pb.id, intervalMinutes: 5, nowMs: past });
    const dueBefore = s.nextRunAt;

    const res = await POST(tickRequest());
    const body = await res.json();

    const triggeredIds = body.triggered.map((t: { scheduleId: string }) => t.scheduleId);
    expect(triggeredIds).toContain(s.id);
    expect(mockRun).toHaveBeenCalled();
    expect(body.principal).toBe("human");
    // nextRunAt advanced past the previous value
    expect(Date.parse(scheduleStore.get(s.id)!.nextRunAt)).toBeGreaterThan(Date.parse(dueBefore));
    expect(scheduleStore.get(s.id)!.lastRunAt).toBeTruthy();
  });

  it("rejects a forged scheduler principal before any agent or schedule work", async () => {
    mockRun.mockClear();
    const request = new Request("http://test/api/agent/schedules/tick", {
      method: "POST",
      headers: { "x-sangfor-internal-principal": "forged.unsigned.principal" },
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("runs a signed scheduler principal once and rejects its replay before a second fake-agent call", async () => {
    mockRun.mockClear();
    mockClaim.mockReset();
    mockClaim.mockResolvedValueOnce({ claimed: true }).mockRejectedValueOnce(new Error("replay"));
    mockRun.mockResolvedValue({ goal: "scheduler", status: "completed", answer: "ok", steps: [] });
    const pb = await playbookStore.create({ name: `${runTag}_schedulerP`, goal: "scheduler run" });
    scheduleStore.create({ playbookId: pb.id, intervalMinutes: 5, nowMs: Date.now() - 10 * 60_000 });
    const request = schedulerRequest();

    const first = await POST(request);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ principal: "scheduler" });
    expect(mockRun).toHaveBeenCalledTimes(1);

    const replay = await POST(request);
    expect(replay.status).toBe(401);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("skips disabled schedules", async () => {
    mockRun.mockClear();
    const pb = await playbookStore.create({ name: `${runTag}_offP`, goal: "x" });
    const s = scheduleStore.create({ playbookId: pb.id, intervalMinutes: 5, nowMs: Date.now() - 10 * 60_000 });
    scheduleStore.update(s.id, { enabled: false });

    const res = await POST(tickRequest());
    const body = await res.json();
    expect(body.triggered.map((t: { scheduleId: string }) => t.scheduleId)).not.toContain(s.id);
  });
});
