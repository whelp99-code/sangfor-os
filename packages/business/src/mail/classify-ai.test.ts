import type { AuthContext } from "@sangfor/auth";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  appendAuditEvent: vi.fn(),
  listCustomers: vi.fn(),
  listOpportunities: vi.fn(),
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
    listCustomers: harness.listCustomers,
  };
});

vi.mock("../crm/opportunity-center", () => ({
  listOpportunities: harness.listOpportunities,
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: harness.appendAuditEvent,
}));

import { revalidateMailDerivedCandidate } from "./classify-ai";

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

function scopedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    candidateType: "customer",
    title: "Customer: Acme",
    summary: "Acme requested a security platform proposal.",
    confidence: 82,
    status: "proposed",
    sourceTitle: "Acme inquiry",
    sourceSender: "buyer@acme.test.kr",
    metadata: {},
    mailInsightThreadId: "thread-1",
    mailInsightThread: { projectId: SALES.projectId },
    knowledgeDocumentId: null,
    updatedAt: VERSION,
    createdAt: VERSION,
  };
}

function fakeTx(candidate = scopedCandidate()) {
  return {
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
    mailDerivedCandidate: {
      findFirst: vi.fn().mockResolvedValue(candidate),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    knowledgeDocument: {
      findFirst: vi.fn(async () => null),
    },
    auditLog: {
      findFirst: vi.fn(async () => null),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.tx = fakeTx();
  harness.listCustomers.mockResolvedValue({
    items: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  harness.listOpportunities.mockResolvedValue({
    items: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
});

describe("revalidateMailDerivedCandidate customer adapter", () => {
  it("delegates an exact normalized customer search with verified context", async () => {
    const result = await revalidateMailDerivedCandidate(
      SALES,
      "candidate-1",
      {
        expectedUpdatedAt: VERSION.toISOString(),
        idempotencyKey: "revalidate-1",
      },
      {
        callLLM: async () =>
          JSON.stringify({
            decision: "approve_candidate",
            confidence: 91,
            reasoningSummary: "Verified external customer evidence.",
            missingFields: [],
            riskFlags: [],
          }),
      },
    );

    expect(harness.listCustomers).toHaveBeenCalledWith(SALES, {
      search: "Acme",
      first: 1,
    });
    expect(harness.listOpportunities).not.toHaveBeenCalled();
    expect(result.revalidation).toEqual(
      expect.objectContaining({
        decision: "approve_candidate",
        mode: "llm",
      }),
    );
    expect(harness.appendAuditEvent).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        eventType: "mail_candidate.revalidated",
        idempotencyKey: "mail_candidate.revalidate:revalidate-1",
      }),
    );
  });

  it("fails before canonical lookup when candidate provenance is foreign", async () => {
    const foreign = scopedCandidate();
    foreign.mailInsightThread = { projectId: "project-foreign" };
    harness.tx = fakeTx(foreign);

    await expect(
      revalidateMailDerivedCandidate(
        SALES,
        "candidate-1",
        {
          expectedUpdatedAt: VERSION.toISOString(),
          idempotencyKey: "revalidate-foreign",
        },
        { callLLM: async () => "{}" },
      ),
    ).rejects.toThrow("mail_candidate_scope_unverified");

    expect(harness.listCustomers).not.toHaveBeenCalled();
    expect(harness.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("contains no direct Customer delegate or default-project resolver", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./classify-ai.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toMatch(/\bprisma\.customer\b/);
    expect(source).not.toMatch(/\btx\.customer\b/);
    expect(source).not.toMatch(
      /resolveProjectId|resolveDefaultProjectId|resolveDefaultProjectSlug/,
    );
    expect(source).toContain("listCustomers(ctx, { search: normalizedName, first: 1 })");
  });
});
