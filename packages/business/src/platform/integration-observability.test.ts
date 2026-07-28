import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({ withRlsTransaction: mocks.withRlsTransaction }));
vi.mock("../governance/audit-db", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

import { acknowledgeObservation, getIntegrationHealth, reprobeTarget } from "./integration-observability";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "system_admin", permissions: [], product: "portal",
};

describe("U067: integration-observability unit tests", () => {
  const tx = { auditLog: { findMany: vi.fn(), findFirst: vi.fn() } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withRlsTransaction.mockImplementation(async (_scope: unknown, callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    tx.auditLog.findMany.mockResolvedValue([]);
    tx.auditLog.findFirst.mockResolvedValue(null);
  });

  it("returns unknown when no persisted observations exist", async () => {
    const result = await getIntegrationHealth({ authContext: CTX });
    expect(result.asOf).toBeNull();
    expect(result.overallState).toBe("unknown");
    expect(result.targets.every((target) => target.state === "unknown" && target.observedAt === null)).toBe(true);
  });

  it("persists injected probe evidence instead of claiming a default success", async () => {
    mocks.appendAuditEvent.mockResolvedValue({ id: "audit1" });
    const result = await reprobeTarget({
      authContext: CTX,
      targetId: "postgres-primary",
      idempotencyKey: "integration-probe-key",
      probeTarget: vi.fn(async () => ({ state: "healthy" as const, latencyMs: 7, errorCode: null, observedAt: "2026-07-26T00:00:00.000Z" })),
    });

    expect(result).toMatchObject({ state: "healthy", latencyMs: 7, observedAt: "2026-07-26T00:00:00.000Z" });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      details: expect.objectContaining({ state: "healthy", latencyMs: 7 }),
    }));
  });

  it("refuses to acknowledge an observation that is not persisted", async () => {
    await expect(acknowledgeObservation({
      authContext: CTX,
      targetId: "postgres-primary",
      observationId: "missing",
      idempotencyKey: "acknowledge-key-1",
    })).rejects.toMatchObject({ code: "observation_not_found" });
  });
});
