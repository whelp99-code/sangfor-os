import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
}));

vi.mock("./audit-db", () => ({ appendAuditEvent: mocks.appendAuditEvent }));

import { listArchivedEntities, restoreArchivedEntity, ArchiveError } from "./archive-lifecycle";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "security_officer", permissions: [], product: "portal",
};

describe("U061: archive-lifecycle unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("restoreArchivedEntity throws restore_status_required for customer without status", async () => {
    await expect(restoreArchivedEntity({
      authContext: CTX,
      entityType: "customer",
      id: "c1",
      expectedVersion: new Date().toISOString(),
    })).rejects.toThrow(ArchiveError);
  });

  it("restoreArchivedEntity throws restore_status_not_applicable for contact with status", async () => {
    await expect(restoreArchivedEntity({
      authContext: CTX,
      entityType: "contact",
      id: "cnt1",
      expectedVersion: new Date().toISOString(),
      restoreStatus: "active",
    })).rejects.toThrow(ArchiveError);
  });
});
