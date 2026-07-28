import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  Prisma: { sql: vi.fn((parts: TemplateStringsArray) => parts.join("?")) },
  withRlsTransaction: mocks.withRlsTransaction,
}));

vi.mock("./audit-db", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

import type { AuthContext } from "@sangfor/auth";
import { ArchiveError, restoreArchivedEntity } from "./archive-lifecycle";

const UPDATED_AT = new Date("2026-07-26T00:00:00.000Z");
const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "security_officer", permissions: [], product: "portal",
};

function installTransaction(model: Record<string, unknown>) {
  const tx = { $executeRaw: vi.fn(), customer: model };
  mocks.withRlsTransaction.mockImplementation(async (_scope, callback) => callback(tx));
  return tx;
}

describe("U061: archive-lifecycle unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendAuditEvent.mockResolvedValue({ id: "audit1" });
  });

  it("throws restore_status_required for customer without status", async () => {
    await expect(restoreArchivedEntity({
      authContext: CTX, entityType: "customer", id: "c1", expectedVersion: UPDATED_AT.toISOString(),
    })).rejects.toThrow(ArchiveError);
  });

  it("restores with one atomic version-and-archive-state CAS", async () => {
    const model = {
      findUnique: vi.fn(async () => ({ id: "c1", status: "archived", updatedAt: UPDATED_AT })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    installTransaction(model);

    const result = await restoreArchivedEntity({
      authContext: CTX,
      entityType: "customer",
      id: "c1",
      expectedVersion: UPDATED_AT.toISOString(),
      restoreStatus: "active",
    });

    expect(result).toMatchObject({ restored: true, id: "c1" });
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", updatedAt: UPDATED_AT, status: "archived" },
      data: { status: "active" },
    });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: `archive-restore:customer:c1:${UPDATED_AT.toISOString()}`,
    }));
  });

  it("returns idempotently when the entity is already restored", async () => {
    const model = {
      findUnique: vi.fn(async () => ({ id: "c1", status: "active", updatedAt: UPDATED_AT })),
      updateMany: vi.fn(),
    };
    installTransaction(model);

    await expect(restoreArchivedEntity({
      authContext: CTX,
      entityType: "customer",
      id: "c1",
      expectedVersion: UPDATED_AT.toISOString(),
      restoreStatus: "active",
    })).resolves.toEqual({ restored: false, reason: "already_restored" });
    expect(model.updateMany).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("fails closed when the CAS loses to a changed archived row", async () => {
    const changedAt = new Date("2026-07-26T00:00:01.000Z");
    const model = {
      findUnique: vi.fn()
        .mockResolvedValueOnce({ id: "c1", status: "archived", updatedAt: UPDATED_AT })
        .mockResolvedValueOnce({ id: "c1", status: "archived", updatedAt: changedAt }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    };
    installTransaction(model);

    await expect(restoreArchivedEntity({
      authContext: CTX,
      entityType: "customer",
      id: "c1",
      expectedVersion: UPDATED_AT.toISOString(),
      restoreStatus: "active",
    })).rejects.toMatchObject({ code: "archive_state_changed", httpStatus: 409 });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
