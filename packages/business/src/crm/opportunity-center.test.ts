import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  canonicalizeRfc8785: (value: unknown) => JSON.stringify(value),
  prisma: {},
  withRlsTransaction: vi.fn(async (_scope, callback: (tx: unknown) => Promise<unknown>) => {
    if (!harness.tx) throw new Error("test transaction is not configured");
    return callback(harness.tx);
  }),
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: harness.appendAuditEvent,
}));

import {
  assignOpportunityOwner,
  createOpportunity,
  createOpportunitySchema,
  getOpportunityDetail,
  listOpportunities,
  opportunityOwnerAssignmentSchema,
  updateOpportunity,
} from "./opportunity-center";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write", "quote.read", "quote.write", "quote.approve_discount"],
  product: "portal",
};

function assignment(id: string, userId: string, companyId = SALES.companyId) {
  return {
    id,
    userId,
    companyId,
    role: "sales_manager",
    status: "active",
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
  };
}

function projectMember(userId: string) {
  return {
    id: `member-${userId}`,
    userId,
    projectId: SALES.projectId,
    status: "active",
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
  };
}

function fakeTx() {
  let opportunity = {
    id: "opp-a",
    projectId: SALES.projectId,
    archivedAt: null as Date | null,
    customerId: "customer-a",
    partnerId: null,
    title: "Opportunity A",
    stage: "LEAD",
    dealType: "NEW_BUILD",
    dealRegistration: null,
    ownerId: "legacy-user",
    ownerAssignmentId: "assignment-old",
    ownershipRevision: 2,
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    userCompanyRole: {
      findMany: vi.fn(async () => [assignment("assignment-actor", SALES.userId)]),
      findFirst: vi.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        where.id === "assignment-new" && where.companyId === SALES.companyId
          ? assignment("assignment-new", "user-new")
          : null),
    },
    projectMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => projectMember(where.userId)),
    },
    auditLog: {
      findFirst: vi.fn(async () => null),
    },
    customer: {
      findFirst: vi.fn(async () => ({ id: "customer-a" })),
    },
    partner: {
      findFirst: vi.fn(async () => ({ id: "partner-a" })),
    },
    opportunity: {
      findMany: vi.fn(async () => [opportunity]),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id && where.id !== opportunity.id) return null;
        if (where.projectId && where.projectId !== opportunity.projectId) return null;
        return opportunity;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        opportunity = { ...opportunity, ...data, ownershipRevision: 0 };
        return opportunity;
      }),
      updateMany: vi.fn(async ({ data }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const ownerIncrement = data.ownershipRevision as { increment?: number } | undefined;
        opportunity = {
          ...opportunity,
          ...data,
          ...(ownerIncrement ? {
            ownershipRevision: opportunity.ownershipRevision + (ownerIncrement.increment ?? 0),
          } : {}),
          updatedAt: new Date("2026-07-24T00:00:01.000Z"),
        };
        return { count: 1 };
      }),
    },
    opportunityStageEvent: {
      create: vi.fn(async () => ({ id: "event-a" })),
    },
  };
  return {
    tx,
    get opportunity() {
      return opportunity;
    },
  };
}

describe("U043 canonical opportunity service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRM_CURSOR_SECRET", "u043-test-cursor-secret-that-is-at-least-thirty-two-bytes");
    harness.tx = fakeTx().tx;
    harness.appendAuditEvent.mockResolvedValue({ id: "audit-a", idempotent: false });
  });

  it("rejects caller scope, a caller-selected stage, and legacy owner authority at create", () => {
    expect(createOpportunitySchema.safeParse({ title: "Valid deal", projectSlug: "foreign" }).success).toBe(false);
    expect(createOpportunitySchema.safeParse({ title: "Valid deal", stage: "WON" }).success).toBe(false);
    expect(createOpportunitySchema.safeParse({ title: "Valid deal", ownerId: "legacy" }).success).toBe(false);
  });

  it("lists only active scoped rows with updatedAt/id keyset ordering and a bounded page", async () => {
    const page = await listOpportunities(SALES, { first: 25 });
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    expect(page.items).toHaveLength(1);
    expect(tx.opportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: SALES.projectId, archivedAt: null }),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 26,
    }));
  });

  it("uses one local {id,projectId,archivedAt} predicate for opaque detail reads", async () => {
    const result = await getOpportunityDetail(SALES, "opp-a");
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    expect(result?.id).toBe("opp-a");
    expect(tx.opportunity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "opp-a", projectId: SALES.projectId, archivedAt: null },
    }));
    await expect(getOpportunityDetail(SALES, "foreign")).resolves.toBeNull();
  });

  it("creates at LEAD under the actor assignment and appends U021 atomically", async () => {
    const created = await createOpportunity(SALES, {
      title: "New Opportunity",
      customerId: "customer-a",
      idempotencyKey: "opp-create-a",
    });
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    expect(created.stage).toBe("LEAD");
    expect(tx.opportunity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: SALES.projectId,
        stage: "LEAD",
        ownerAssignmentId: "assignment-actor",
      }),
    });
    expect(harness.appendAuditEvent).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventType: "opportunity.created",
      actorId: "assignment-actor",
      idempotencyKey: "opportunity.create:opp-create-a",
    }));
  });

  it("changes only canonical ownerAssignmentId and increments ownershipRevision once", async () => {
    const result = await assignOpportunityOwner(SALES, "opp-a", {
      ownerAssignmentId: "assignment-new",
      expectedOwnershipRevision: 2,
      idempotencyKey: "owner-a",
    });
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    expect(result.ownerAssignmentId).toBe("assignment-new");
    expect(result.ownershipRevision).toBe(3);
    expect(tx.opportunity.updateMany).toHaveBeenCalledWith({
      where: {
        id: "opp-a",
        projectId: SALES.projectId,
        archivedAt: null,
        ownerAssignmentId: "assignment-old",
        ownershipRevision: 2,
      },
      data: {
        ownerAssignmentId: "assignment-new",
        ownershipRevision: { increment: 1 },
      },
    });
    expect(tx.opportunity.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("ownerId");
    expect(tx.opportunity.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("stage");
  });

  it("rejects a missing/negative revision and any combined owner/domain mutation", () => {
    expect(opportunityOwnerAssignmentSchema.safeParse({
      ownerAssignmentId: "assignment-new",
      idempotencyKey: "owner-a",
    }).success).toBe(false);
    expect(opportunityOwnerAssignmentSchema.safeParse({
      ownerAssignmentId: "assignment-new",
      expectedOwnershipRevision: -1,
      idempotencyKey: "owner-a",
    }).success).toBe(false);
    expect(opportunityOwnerAssignmentSchema.safeParse({
      ownerAssignmentId: "assignment-new",
      expectedOwnershipRevision: 2,
      idempotencyKey: "owner-a",
      stage: "WON",
    }).success).toBe(false);
  });

  it("maps an ownership CAS loser to 409 with no audit", async () => {
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    tx.opportunity.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(assignOpportunityOwner(SALES, "opp-a", {
      ownerAssignmentId: "assignment-new",
      expectedOwnershipRevision: 2,
      idempotencyKey: "owner-stale",
    })).rejects.toMatchObject({ code: "CONFLICT", httpStatus: 409 });
    expect(harness.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("keeps expectedUpdatedAt CAS separate from ownership revision for domain updates", async () => {
    const updated = await updateOpportunity(SALES, "opp-a", {
      expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      changes: { title: "Updated Opportunity" },
      idempotencyKey: "opp-update-a",
    });
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    expect(updated.title).toBe("Updated Opportunity");
    expect(tx.opportunity.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        updatedAt: new Date("2026-07-24T00:00:00.000Z"),
      }),
      data: { title: "Updated Opportunity" },
    }));
    expect(tx.opportunity.updateMany.mock.calls[0]?.[0].where).not.toHaveProperty("ownershipRevision");
  });
});
