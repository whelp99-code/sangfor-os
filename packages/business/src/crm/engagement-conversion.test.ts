import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  opportunity: {
    id: "opportunity-1",
    projectId: "project-a",
    customerId: "customer-1",
    title: "Scoped opportunity",
    stage: "POC",
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
  },
  executeOpportunityConversion: vi.fn(),
}));

vi.mock("./opportunity-center", () => ({
  opportunityConversionCommandSchema: {
    parse: (value: Record<string, unknown>) => {
      const keys = Object.keys(value);
      if (
        keys.some(
          (key) =>
            !["opportunityId", "expectedUpdatedAt", "idempotencyKey"].includes(key),
        )
      ) {
        throw new Error("invalid_opportunity_command");
      }
      return value;
    },
  },
  executeOpportunityConversion: harness.executeOpportunityConversion,
  withScopedOpportunityRead: vi.fn(),
}));

import {
  convertOpportunityToProject,
  convertOpportunityToProjectSchema,
} from "./engagement-center";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["opportunity.read", "opportunity.write"],
  product: "portal",
};

const COMMAND = {
  opportunityId: "opportunity-1",
  expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
  idempotencyKey: "convert-opportunity-1",
};

function fakeTx(existing: Record<string, unknown> | null = null) {
  return {
    engagement: {
      findUnique: vi.fn(async () => existing),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "engagement-1",
        ...data,
      })),
    },
    quote: {
      findFirst: vi.fn(async () => ({
        id: "quote-1",
        totalRevenue: 480,
      })),
    },
    opportunityLink: {
      findMany: vi.fn(async ({ where }: { where: { entityType: string } }) =>
        where.entityType === "proposal"
          ? [{ entityId: "document-1" }]
          : [{ entityId: "poc-1" }],
      ),
    },
    generatedDocument: {
      findMany: vi.fn(async () => [{ id: "document-1" }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 1),
    },
    pocProject: {
      findMany: vi.fn(async () => [{ id: "poc-1" }]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 1),
    },
    meetingNote: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 1),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.tx = fakeTx();
  harness.executeOpportunityConversion.mockImplementation(
    async (
      _ctx: AuthContext,
      _command: typeof COMMAND,
      materialize: (
        tx: Record<string, unknown>,
        opportunity: typeof harness.opportunity,
      ) => Promise<unknown>,
    ) => {
      if (!harness.tx) throw new Error("test transaction is not configured");
      return materialize(harness.tx, harness.opportunity);
    },
  );
});

describe("canonical Opportunity to Engagement conversion", () => {
  it("accepts only versioned, idempotent conversion input", () => {
    expect(() =>
      convertOpportunityToProjectSchema.parse({
        ...COMMAND,
        force: true,
      }),
    ).toThrow("invalid_opportunity_command");
  });

  it("delegates scope, CAS, idempotency, and audit ownership to the canonical command", async () => {
    const result = await convertOpportunityToProject(SALES, COMMAND);

    expect(harness.executeOpportunityConversion).toHaveBeenCalledWith(
      SALES,
      COMMAND,
      expect.any(Function),
    );
    expect(result).toEqual(
      expect.objectContaining({
        created: true,
        engagement: expect.objectContaining({
          id: "engagement-1",
          opportunityId: "opportunity-1",
          projectId: SALES.projectId,
          amountQuoteId: "quote-1",
        }),
        absorbed: { proposals: 1, poc: 1, quotes: 1, meetings: 1 },
      }),
    );
  });

  it("returns the existing scoped Engagement without a duplicate create", async () => {
    const existing = {
      id: "engagement-existing",
      opportunityId: "opportunity-1",
      projectId: SALES.projectId,
      amountQuoteId: "quote-1",
    };
    const tx = fakeTx(existing);
    harness.tx = tx;

    const result = await convertOpportunityToProject(SALES, COMMAND);

    expect(result).toEqual({
      engagement: existing,
      created: false,
      absorbed: { proposals: 1, poc: 1, quotes: 1, meetings: 1 },
    });
    expect(tx.engagement.create).not.toHaveBeenCalled();
  });
});
