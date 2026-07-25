import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  withRlsTransaction: vi.fn(),
  appendAuditEvent: vi.fn(),
  requireCurrentAiReleaseEvaluation: vi.fn(),
  requireCurrentQuoteVendorReadiness: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: mocks.withRlsTransaction,
  canonicalizeRfc8785: (v: unknown) => JSON.stringify(v),
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

vi.mock("../governance/ai-release-evaluation-service", () => ({
  requireCurrentAiReleaseEvaluation: mocks.requireCurrentAiReleaseEvaluation,
}));

vi.mock("./vendor-request", () => ({
  requireCurrentQuoteVendorReadiness: mocks.requireCurrentQuoteVendorReadiness,
}));

import {
  acceptDeliveryProjection,
  addUtcTermMonths,
  DeliveryAcceptanceError,
} from "./delivery-acceptance";
import type { AuthContext } from "@sangfor/auth";

const CTX: AuthContext = {
  userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
  businessRole: "sales_manager", permissions: [], product: "portal",
};

describe("U051: delivery-acceptance unit tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calculates UTC term months clamping to end of month (e.g. Jan 31 + 1m -> Feb 28)", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31, 12, 0, 0));
    const result = addUtcTermMonths(jan31, 1);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(1); // Feb
    expect(result.getUTCDate()).toBe(28); // Clamped to 28
  });

  it("rejects when required parameters are missing", async () => {
    await expect(acceptDeliveryProjection({
      authContext: CTX, engagementId: "", quoteId: "q1", artifactVersionId: "av1", idempotencyKey: "k1",
    })).rejects.toThrow("engagementId, quoteId, artifactVersionId, and idempotencyKey required");
  });

  it("projects quote lines into customer assets, licenses, and subscriptions", async () => {
    mocks.withRlsTransaction.mockImplementation(async (_s: unknown, cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        userCompanyRole: { findFirst: vi.fn(async () => ({ id: "ucr1", userId: "u1" })) },
        deliveryAcceptance: {
          findFirst: vi.fn(async () => null),
          create: vi.fn(async () => ({ id: "acc1", engagementId: "eng1", quoteId: "q1", artifactVersionId: "av1", acceptedAt: new Date() })),
        },
        engagement: { findUniqueOrThrow: vi.fn(async () => ({ id: "eng1", customerId: "cust1" })) },
        quote: { findUniqueOrThrow: vi.fn(async () => ({ id: "q1", contentHash: "hash1" })) },
        quoteLineItem: {
          findMany: vi.fn(async () => [
            { id: "l1", lineType: "service" }, // no asset created
            { id: "l2", lineType: "product", termMonths: 0, skuId: "sku1", licenseMetricKey: "cores", quantityDecimal: 10 }, // perpetual
            { id: "l3", lineType: "product", termMonths: 12, skuId: "sku2", licenseMetricKey: "users", quantityDecimal: 5 }, // subscription
          ]),
        },
        customerAsset: { create: vi.fn(async () => ({ id: "asset1" })) },
        assetLicense: { create: vi.fn(async () => ({ id: "lic1" })) },
        subscription: { create: vi.fn(async () => ({ id: "sub1" })) },
      };
      return cb(tx);
    });

    mocks.requireCurrentAiReleaseEvaluation.mockResolvedValue({ eligible: true, blockers: [] });
    mocks.requireCurrentQuoteVendorReadiness.mockResolvedValue({ eligible: true, blockers: [] });

    const res = await acceptDeliveryProjection({
      authContext: CTX,
      engagementId: "eng1",
      quoteId: "q1",
      artifactVersionId: "av1",
      idempotencyKey: "k-acc-1",
    });

    expect(res.acceptanceId).toBe("acc1");
    expect(res.createdAssetsCount).toBe(2);
    expect(res.createdLicensesCount).toBe(2);
    expect(res.createdSubscriptionsCount).toBe(1);
  });
});
