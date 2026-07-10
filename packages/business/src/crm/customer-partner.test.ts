import { describe, it, expect, vi, beforeEach } from "vitest";

// customer-partner.ts uses prisma directly (no DI seam), so mock @sangfor/db
// at the module level.
vi.mock("@sangfor/db", () => {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown) => (calls[name] ??= []).push(args);

  const customerFindUniqueOrThrow = vi.fn(async (args: { where: { id: string } }) => {
    record("customer.findUniqueOrThrow", args);
    return { id: args.where.id, projectId: "proj-1", name: "CustomerCo" };
  });

  const customerUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    record("customer.update", args);
    return { id: args.where.id, projectId: "proj-1", name: "CustomerCo", ...args.data };
  });

  const partnerUpdate = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    record("partner.update", args);
    return { id: args.where.id, projectId: "proj-1", name: "PartnerCo", ...args.data };
  });

  const customerActivityLogCreate = vi.fn(async () => {});

  return {
    prisma: {
      project: { findUniqueOrThrow: vi.fn(async () => ({ id: "proj-1" })) },
      customer: { findUniqueOrThrow: customerFindUniqueOrThrow, update: customerUpdate, findMany: vi.fn(async () => []) },
      partner: { update: partnerUpdate, findMany: vi.fn(async () => []) },
      contact: { create: vi.fn() },
      customerActivityLog: { create: customerActivityLogCreate },
      customerPartnerLink: { upsert: vi.fn() },
      workTask: { create: vi.fn(), findFirst: vi.fn(async () => null) },
    },
  };
});
vi.mock("../governance/audit", () => ({ logStateTransition: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../governance/ai-decision", () => ({ recordDecision: vi.fn().mockResolvedValue(undefined) }));

import { archiveCustomer, archivePartner, updateCustomer, updatePartner } from "./customer-partner";
import { recordDecision } from "../governance/ai-decision";

describe("customer-partner characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("archiveCustomer", () => {
    it("archives directly and records exactly one entity_archive decision", async () => {
      const result = await archiveCustomer("cust-1");

      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "entity_archive",
          projectId: "proj-1",
          caseRef: "cust:cust-1",
          outcome: "approved",
        }),
      );

      expect(result.status).toBe("archived");
    });
  });

  describe("archivePartner", () => {
    it("archives directly and records exactly one entity_archive decision", async () => {
      const result = await archivePartner("partner-1");

      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "entity_archive",
          projectId: "proj-1",
          caseRef: "partner:partner-1",
          outcome: "approved",
        }),
      );

      expect(result.status).toBe("archived");
    });
  });

  describe("updateCustomer — edit capture", () => {
    it("records an entity_edit decision after update", async () => {
      await updateCustomer("cust-1", { name: "New Name" });

      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "entity_edit",
          projectId: "proj-1",
          caseRef: "cust:cust-1",
          outcome: "corrected",
          humanEdit: { name: "New Name" },
        }),
      );
    });
  });

  describe("updatePartner — edit capture", () => {
    it("records an entity_edit decision after update", async () => {
      await updatePartner("partner-1", { name: "New Partner" });

      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "entity_edit",
          projectId: "proj-1",
          caseRef: "partner:partner-1",
          outcome: "corrected",
          humanEdit: { name: "New Partner" },
        }),
      );
    });
  });
});
