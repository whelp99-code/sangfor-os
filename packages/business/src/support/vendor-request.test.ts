import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  recordAuditLog: vi.fn(),
  evaluateCommercialApproval: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: vi.fn(async () => ({ sequence: 1, idempotent: false })),
}));

vi.mock("../governance/commercial-approval", () => ({
  evaluateCommercialApproval: vi.fn(() => ({ blocked: false, reasons: [] })),
}));

import {
  createVendorRequest,
  reassignVendorRequestOwner,
  recordVendorRequestEvent,
  recordVendorRequestOutcome,
  requireCurrentQuoteVendorReadiness,
  VendorRequestError,
} from "./vendor-request";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "sales_manager", permissions: ["vendor_request.create" as any], product: "portal",
};

describe("U049: vendor-request service unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects missing idempotencyKey or opportunityId", async () => {
    await expect(createVendorRequest({
      authContext: CTX, requestType: "special_discount", idempotencyKey: "",
    })).rejects.toThrow("idempotencyKey is required");
  });

  it("creates vendor request for special discount", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1" })) },
        quote: { findUniqueOrThrow: vi.fn(async () => ({ id: "q1", opportunityId: "opp1", totalRevenue: 1000, totalCost: 500 })) },
        vendorRequest: {
          findFirst: vi.fn(async () => null),
          create: vi.fn(async () => ({ id: "vreq1", status: "ready_for_manual_submission", revision: 0, ownershipRevision: 0 })),
        },
        discountRequest: { create: vi.fn(async () => ({ id: "disc1" })) },
        vendorRequestEvent: { create: vi.fn(async () => ({ id: "evt1" })) },
      };
      return cb(tx);
    });

    const res = await createVendorRequest({
      authContext: CTX,
      opportunityId: "opp1",
      quoteId: "q1",
      requestType: "special_discount",
      idempotencyKey: "k1",
    });

    expect(res.requestId).toBe("vreq1");
    expect(res.discountRequestId).toBe("disc1");
    expect(res.status).toBe("ready_for_manual_submission");
  });

  it("reassigns owner with CAS ownershipRevision increment", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        vendorRequest: {
          findUniqueOrThrow: vi.fn(async () => ({ id: "vreq1", status: "ready_for_manual_submission", revision: 0, ownershipRevision: 0, ownerAssignmentId: "ucr1" })),
          update: vi.fn(async () => ({})),
        },
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr2", userId: "u2" })) },
        vendorRequestEvent: { create: vi.fn(async () => ({ id: "evt2" })) },
      };
      return cb(tx);
    });

    const res = await reassignVendorRequestOwner({
      authContext: CTX,
      requestId: "vreq1",
      ownerAssignmentId: "ucr2",
      expectedOwnershipRevision: 0,
      idempotencyKey: "k-reassign-1",
    });

    expect(res.ownershipRevision).toBe(1);
    expect(res.ownerAssignmentId).toBe("ucr2");
  });

  it("records tagged event and advances revision", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        vendorRequest: {
          findUniqueOrThrow: vi.fn(async () => ({ id: "vreq1", status: "ready_for_manual_submission", revision: 0, externalReference: null })),
          update: vi.fn(async () => ({})),
        },
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1" })) },
        vendorRequestEvent: { create: vi.fn(async () => ({ id: "evt3" })) },
      };
      return cb(tx);
    });

    const res = await recordVendorRequestEvent({
      authContext: CTX,
      requestId: "vreq1",
      event: "record_manual_submission",
      expectedRevision: 0,
      externalReference: "VND-REF-100",
      idempotencyKey: "k-evt-1",
    });

    expect(res.status).toBe("manually_submitted");
    expect(res.revision).toBe(1);
  });
});
