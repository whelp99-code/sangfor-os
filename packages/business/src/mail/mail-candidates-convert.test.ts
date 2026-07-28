import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  appendAuditEvent: vi.fn(),
  mergeCustomer: vi.fn(),
  mergePartner: vi.fn(),
  mergeOpportunity: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  canonicalizeRfc8785: (value: unknown) => JSON.stringify(value),
  withRlsTransaction: vi.fn(
    async (_ctx: unknown, callback: (tx: unknown) => Promise<unknown>) => {
      if (!harness.tx) throw new Error("test transaction is not configured");
      return callback(harness.tx);
    },
  ),
}));

vi.mock("../crm/customer-partner", () => {
  class CrmServiceError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    CrmServiceError,
    mergeMailDerivedCustomerInScopedTransaction: harness.mergeCustomer,
    mergeMailDerivedPartnerInScopedTransaction: harness.mergePartner,
  };
});

vi.mock("../crm/opportunity-center", () => ({
  mergeMailDerivedOpportunityInScopedTransaction: harness.mergeOpportunity,
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: harness.appendAuditEvent,
}));

import {
  convertApprovedMailCandidates,
  convertApprovedMailCandidatesSchema,
} from "./mail-candidates-convert";

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

const VERSION = new Date("2026-07-24T00:00:00.000Z");

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    candidateType: "customer",
    title: "Customer: Acme",
    summary: "Security platform buyer",
    status: "approved",
    confidence: 90,
    metadata: {},
    createdEntityType: null,
    createdEntityId: null,
    knowledgeDocumentId: null,
    mailInsightThreadId: "thread-1",
    mailInsightThread: { projectId: SALES.projectId },
    sourceSender: "buyer@acme.co.kr",
    sourceTitle: "Acme inquiry",
    updatedAt: VERSION,
    ...overrides,
  };
}

function activeRole() {
  return {
    id: "assignment-sales",
    userId: SALES.userId,
    companyId: SALES.companyId,
    role: "sales_manager",
    status: "active",
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
  };
}

function fakeTx(rows = [candidate()]) {
  const state = {
    audit: null as null | { details: Record<string, unknown> },
    updated: [] as string[],
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    userCompanyRole: {
      findMany: vi.fn(async () => [activeRole()]),
    },
    projectMember: {
      findFirst: vi.fn(async () => ({
        id: "member-sales",
        userId: SALES.userId,
        projectId: SALES.projectId,
        status: "active",
        validFrom: null,
        expiresAt: null,
        revokedAt: null,
      })),
    },
    auditLog: {
      findFirst: vi.fn(async () => state.audit),
    },
    mailDerivedCandidate: {
      findMany: vi.fn(async () => rows),
      updateMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        state.updated.push(where.id);
        return { count: 1 };
      }),
    },
    project: {
      findFirst: vi.fn(async () => ({
        id: SALES.projectId,
        company: { tenantId: SALES.tenantId },
      })),
    },
    knowledgeDocument: {
      findMany: vi.fn(async () => []),
    },
    workTask: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "task-1" })),
    },
  };
  return { tx, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  const configured = fakeTx();
  harness.tx = configured.tx;
  harness.mergeCustomer.mockResolvedValue({
    entity: { id: "customer-1" },
    created: true,
  });
  harness.mergePartner.mockResolvedValue({
    entity: { id: "partner-1" },
    created: true,
  });
  harness.mergeOpportunity.mockResolvedValue({
    entity: { id: "opportunity-1" },
    created: true,
  });
});

describe("convertApprovedMailCandidates", () => {
  it("rejects missing, duplicate, and caller-scoped command fields", () => {
    expect(convertApprovedMailCandidatesSchema.safeParse({}).success).toBe(false);
    expect(
      convertApprovedMailCandidatesSchema.safeParse({
        candidates: [
          { id: "candidate-1", expectedUpdatedAt: VERSION.toISOString() },
          { id: "candidate-1", expectedUpdatedAt: VERSION.toISOString() },
        ],
        idempotencyKey: "batch-1",
      }).success,
    ).toBe(false);
    expect(
      convertApprovedMailCandidatesSchema.safeParse({
        candidates: [{ id: "candidate-1", expectedUpdatedAt: VERSION.toISOString() }],
        idempotencyKey: "batch-1",
        projectId: "attacker-project",
      }).success,
    ).toBe(false);
  });

  it("uses the canonical scoped customer command and records item plus batch audit", async () => {
    const result = await convertApprovedMailCandidates(SALES, {
      candidates: [{ id: "candidate-1", expectedUpdatedAt: VERSION.toISOString() }],
      idempotencyKey: "batch-1",
    });

    expect(result.items).toEqual([
      {
        candidateId: "candidate-1",
        entityType: "customer",
        entityId: "customer-1",
        created: true,
      },
    ]);
    expect(harness.mergeCustomer).toHaveBeenCalledWith(
      harness.tx,
      SALES,
      expect.objectContaining({
        name: "Acme",
        domain: "acme.co.kr",
        idempotencyKey: "batch-1:candidate-1",
      }),
    );
    expect(harness.appendAuditEvent).toHaveBeenCalledTimes(2);
    expect(harness.appendAuditEvent).toHaveBeenLastCalledWith(
      harness.tx,
      expect.objectContaining({
        eventType: "mail_candidates.converted",
        idempotencyKey: "mail_candidate.convert:batch-1",
      }),
    );
  });

  it("fails closed for foreign or unverified candidate provenance", async () => {
    const configured = fakeTx([
      candidate({ mailInsightThread: { projectId: "project-foreign" } }),
    ]);
    harness.tx = configured.tx;

    await expect(
      convertApprovedMailCandidates(SALES, {
        candidates: [{ id: "candidate-1", expectedUpdatedAt: VERSION.toISOString() }],
        idempotencyKey: "batch-foreign",
      }),
    ).rejects.toThrow("mail_candidate_provenance_unverified");

    expect(harness.mergeCustomer).not.toHaveBeenCalled();
    expect(harness.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a stale candidate version before entity mutation", async () => {
    const configured = fakeTx([
      candidate({ updatedAt: new Date("2026-07-24T01:00:00.000Z") }),
    ]);
    harness.tx = configured.tx;

    await expect(
      convertApprovedMailCandidates(SALES, {
        candidates: [{ id: "candidate-1", expectedUpdatedAt: VERSION.toISOString() }],
        idempotencyKey: "batch-stale",
      }),
    ).rejects.toThrow("mail_candidate_version_conflict");

    expect(harness.mergeCustomer).not.toHaveBeenCalled();
  });

  it("rejects changed-key reuse from the scoped audit receipt", async () => {
    const configured = fakeTx();
    configured.state.audit = {
      details: {
        contract: "sangfor.mail_candidate.convert/v1",
        inputHash: "different-input",
        result: {},
      },
    };
    harness.tx = configured.tx;

    await expect(
      convertApprovedMailCandidates(SALES, {
        candidates: [{ id: "candidate-1", expectedUpdatedAt: VERSION.toISOString() }],
        idempotencyKey: "batch-reused",
      }),
    ).rejects.toThrow("mail_candidate_idempotency_conflict");

    expect(harness.mergeCustomer).not.toHaveBeenCalled();
  });

  it("propagates audit failure so the transaction can roll back every write", async () => {
    harness.appendAuditEvent.mockRejectedValueOnce(new Error("forced_audit_failure"));

    await expect(
      convertApprovedMailCandidates(SALES, {
        candidates: [{ id: "candidate-1", expectedUpdatedAt: VERSION.toISOString() }],
        idempotencyKey: "batch-audit-failure",
      }),
    ).rejects.toThrow("forced_audit_failure");
  });
});
