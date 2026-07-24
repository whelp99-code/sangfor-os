import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convertApprovedMailCandidates: vi.fn(),
}));

vi.mock("./mail-candidates-convert", () => ({
  convertApprovedMailCandidates: mocks.convertApprovedMailCandidates,
}));

import { approveMailDerivedCandidate } from "./candidates-update";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write"],
  product: "portal",
};

const RECEIPT = {
  customersCreated: 1,
  partnersCreated: 0,
  customersSkipped: 0,
  partnersSkipped: 0,
  customersMerged: 0,
  partnersMerged: 0,
  opportunitiesCreated: 0,
  tasksCreated: 0,
  items: [
    {
      candidateId: "candidate-1",
      entityType: "customer",
      entityId: "customer-1",
      created: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.convertApprovedMailCandidates.mockResolvedValue(RECEIPT);
});

describe("approveMailDerivedCandidate compatibility delegate", () => {
  it("passes only verified context, exact candidate version, and idempotency key", async () => {
    const result = await approveMailDerivedCandidate(SALES, "candidate-1", {
      expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "approve-candidate-1",
    });

    expect(result).toEqual(RECEIPT);
    expect(mocks.convertApprovedMailCandidates).toHaveBeenCalledWith(SALES, {
      candidates: [
        {
          id: "candidate-1",
          expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        },
      ],
      idempotencyKey: "approve-candidate-1",
    });
  });

  it("leaves concurrent serialization and replay to the one canonical coordinator", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        approveMailDerivedCandidate(SALES, "candidate-1", {
          expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
          idempotencyKey: "approve-candidate-1",
        }),
      ),
    );

    expect(results).toEqual(Array.from({ length: 10 }, () => RECEIPT));
    expect(mocks.convertApprovedMailCandidates).toHaveBeenCalledTimes(10);
    expect(
      mocks.convertApprovedMailCandidates.mock.calls.every(
        ([ctx, command]) =>
          ctx === SALES &&
          command.idempotencyKey === "approve-candidate-1" &&
          command.candidates.length === 1,
      ),
    ).toBe(true);
  });

  it("does not catch or translate canonical conflicts", async () => {
    mocks.convertApprovedMailCandidates.mockRejectedValueOnce(
      new Error("mail_candidate_version_conflict"),
    );

    await expect(
      approveMailDerivedCandidate(SALES, "candidate-1", {
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        idempotencyKey: "approve-candidate-1",
      }),
    ).rejects.toThrow("mail_candidate_version_conflict");
  });
});
