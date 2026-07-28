import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

import {
  updateRenewalLifecycle,
  RenewalError,
} from "./renewal-projection";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "sales_manager", permissions: [], product: "portal",
};

describe("U052: renewal-projection service unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid status transitions (e.g. pending -> renewed directly)", async () => {
    await expect(updateRenewalLifecycle({
      authContext: CTX,
      renewalOpportunityId: "ren1",
      expectedStatus: "pending",
      expectedUpdatedAt: "2026-07-25T12:00:00Z",
      nextStatus: "renewed",
      idempotencyKey: "k1",
      now: new Date(),
    })).rejects.toThrow("Cannot transition from pending to renewed");
  });

  it("updates renewal lifecycle with valid CAS status transition", async () => {
    const updatedAt = new Date("2026-07-25T12:00:00Z");

    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        renewalOpportunity: {
          findUniqueOrThrow: vi.fn(async () => ({
            id: "ren1", status: "pending", updatedAt, notes: null,
          })),
          update: vi.fn(async () => ({
            id: "ren1", status: "notified", updatedAt: new Date(), notes: "Notified customer",
          })),
        },
      };
      return cb(tx);
    });

    const res = await updateRenewalLifecycle({
      authContext: CTX,
      renewalOpportunityId: "ren1",
      expectedStatus: "pending",
      expectedUpdatedAt: updatedAt,
      nextStatus: "notified",
      notes: "Notified customer",
      idempotencyKey: "k-lc-1",
      now: new Date(),
    });

    expect(res.status).toBe("notified");
  });
});
