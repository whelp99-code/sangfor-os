import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  canonicalizeRfc8785: (value: unknown) => JSON.stringify(value, Object.keys(value as object).sort()),
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
  archiveCustomer,
  createCustomer,
  createCustomerSchema,
  getCustomerDetail,
  listCustomers,
  updateCustomer,
} from "./customer-partner";

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

function activeRole(role = "sales_manager") {
  return {
    id: `assignment-${role}`,
    userId: SALES.userId,
    companyId: SALES.companyId,
    role,
    status: "active",
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
  };
}

function activeMember() {
  return {
    id: "member-a",
    userId: SALES.userId,
    projectId: SALES.projectId,
    status: "active",
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
  };
}

function fakeTx() {
  let customer = {
    id: "customer-a",
    projectId: SALES.projectId,
    archivedAt: null,
    name: "Customer A",
    domain: "customer.example",
    industry: "IT",
    notes: null,
    status: "active",
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    userCompanyRole: {
      findMany: vi.fn(async () => [activeRole()]),
    },
    projectMember: {
      findFirst: vi.fn(async () => activeMember()),
    },
    customer: {
      findMany: vi.fn(async () => [customer]),
      findFirst: vi.fn(async () => customer),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        customer = { ...customer, ...data };
        return customer;
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        customer = { ...customer, ...data, updatedAt: new Date("2026-07-24T00:00:01.000Z") };
        return { count: 1 };
      }),
    },
    auditLog: {
      findFirst: vi.fn(async () => null),
    },
  };
  return {
    tx,
    get customer() {
      return customer;
    },
    setRole(role: string) {
      tx.userCompanyRole.findMany.mockResolvedValue([activeRole(role)]);
    },
  };
}

describe("U043 canonical customer service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRM_CURSOR_SECRET", "u043-test-cursor-secret-that-is-at-least-thirty-two-bytes");
    const fake = fakeTx();
    harness.tx = fake.tx;
    harness.appendAuditEvent.mockResolvedValue({ id: "audit-a", idempotent: false });
  });

  it("rejects caller-selected scope and unknown create fields", () => {
    expect(createCustomerSchema.safeParse({ name: "Valid Name", projectSlug: "foreign" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "Valid Name", actor: "caller" }).success).toBe(false);
    expect(createCustomerSchema.safeParse({ name: "Valid Name", status: "active" }).success).toBe(false);
  });

  it("lists with project + archive predicates and updatedAt/id keyset ordering", async () => {
    const page = await listCustomers(SALES, { first: 25, search: "customer" });
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];

    expect(page.items).toHaveLength(1);
    expect(tx.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: SALES.projectId,
          archivedAt: null,
        }),
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 26,
      }),
    );
  });

  it("loads the complete detail model from one scoped customer predicate", async () => {
    const customer = await getCustomerDetail(SALES, "customer-a");
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];

    expect(customer?.id).toBe("customer-a");
    expect(tx.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "customer-a", projectId: SALES.projectId, archivedAt: null },
        include: expect.objectContaining({
          customerAssets: expect.any(Object),
          renewalOpportunities: expect.any(Object),
          supportCases: expect.any(Object),
        }),
      }),
    );
  });

  it("creates and appends the exact U021 event in the same scoped transaction", async () => {
    const result = await createCustomer(SALES, {
      name: "Customer A",
      domain: "customer.example",
      idempotencyKey: "customer-create-a",
    });
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];

    expect(result.id).toBe("customer-a");
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: SALES.projectId,
        name: "Customer A",
        domain: "customer.example",
      }),
    });
    expect(harness.appendAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: "customer.created",
        actorId: "assignment-sales_manager",
        resourceId: "customer-a",
        idempotencyKey: "customer.create:customer-create-a",
        details: expect.objectContaining({
          inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          result: expect.objectContaining({ id: "customer-a" }),
        }),
      }),
    );
  });

  it("uses exact expectedUpdatedAt CAS for update and archive", async () => {
    const expectedUpdatedAt = "2026-07-24T00:00:00.000Z";
    const updated = await updateCustomer(SALES, "customer-a", {
      expectedUpdatedAt,
      idempotencyKey: "customer-update-a",
      changes: { name: "Customer A2" },
    });
    expect(updated.name).toBe("Customer A2");

    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    expect(tx.customer.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "customer-a",
          projectId: SALES.projectId,
          archivedAt: null,
          updatedAt: new Date(expectedUpdatedAt),
        },
      }),
    );

    await archiveCustomer(SALES, "customer-a", {
      expectedUpdatedAt: "2026-07-24T00:00:01.000Z",
      idempotencyKey: "customer-archive-a",
    });
    expect(tx.customer.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ status: "archived", archivedAt: expect.any(Date) }),
      }),
    );
    expect(harness.appendAuditEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: "customer.archived" }),
    );
  });

  it("fails closed when the persisted active role lacks customer.write", async () => {
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    tx.userCompanyRole.findMany.mockResolvedValue([activeRole("account_manager")]);

    await expect(
      createCustomer(SALES, {
        name: "Denied Customer",
        idempotencyKey: "denied-create",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it("maps a CAS loser to a stable 409 without a partial audit", async () => {
    const tx = harness.tx as ReturnType<typeof fakeTx>["tx"];
    tx.customer.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      updateCustomer(SALES, "customer-a", {
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        idempotencyKey: "stale-update",
        changes: { name: "Stale" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", httpStatus: 409 });
    expect(harness.appendAuditEvent).not.toHaveBeenCalled();
  });
});
