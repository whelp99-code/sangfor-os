import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./governance/audit", () => ({ logStateTransition: vi.fn().mockResolvedValue(undefined) }));

import { createPocProject, getPocDetail, type PocCenterPrisma } from "./poc-center";
import { logStateTransition } from "./governance/audit";

/** Call-recording fake, following domain-persistence.test.ts's fakePrisma() style. */
function fakePrisma() {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown) => (calls[name] ??= []).push(args);

  let pocDetail: Record<string, unknown> = {
    id: "poc-1",
    title: "Test PoC",
    checklistItems: [],
    issues: [],
    requirementRows: [],
    events: [],
    resultReports: [],
  };

  const db: PocCenterPrisma = {
    project: {
      findUniqueOrThrow: vi.fn(async (args) => {
        record("project.findUniqueOrThrow", args);
        return { id: "proj-1" };
      }),
    },
    pocProject: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        record("pocProject.create", args);
        return { id: "poc-1", ...args.data };
      }),
      findUnique: vi.fn(async (args) => {
        record("pocProject.findUnique", args);
        return pocDetail;
      }),
    },
    opportunityLink: {
      upsert: vi.fn(async (args: { create: Record<string, unknown> }) => {
        record("opportunityLink.upsert", args);
        return { id: "link-1", ...args.create };
      }),
    },
    pocChecklistItem: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createMany: vi.fn(async (args: { data: any[] }) => {
        record("pocChecklistItem.createMany", args);
        return { count: args.data.length };
      }),
    },
  };

  return {
    db,
    calls,
    setPocDetail(row: Record<string, unknown>) {
      pocDetail = row;
    },
  };
}

describe("poc-center characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createPocProject", () => {
    it("creates the POC, seeds the default checklist, and skips the opportunity link when none given", async () => {
      const { db, calls } = fakePrisma();

      await createPocProject({ title: "Firewall PoC", projectSlug: "demo-project" }, { prisma: db });

      expect(calls["project.findUniqueOrThrow"]?.[0]).toEqual({ where: { slug: "demo-project" } });

      const createArgs = calls["pocProject.create"][0] as { data: Record<string, unknown> };
      expect(createArgs.data.title).toBe("Firewall PoC");
      expect(createArgs.data.projectId).toBe("proj-1");

      expect(calls["opportunityLink.upsert"]).toBeUndefined();

      const checklistArgs = calls["pocChecklistItem.createMany"][0] as {
        data: Array<{ pocProjectId: string; label: string; sortOrder: number }>;
      };
      expect(checklistArgs.data.map((item) => item.label)).toEqual([
        "Scope confirmation",
        "Hardware spec review",
        "Network topology review",
        "Environment setup",
        "Success criteria review",
        "Final result report",
      ]);
      expect(checklistArgs.data.every((item) => item.pocProjectId === "poc-1")).toBe(true);
      expect(checklistArgs.data.map((item) => item.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);

      expect(logStateTransition).toHaveBeenCalledTimes(1);
      expect(logStateTransition).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "poc_project", fromStatus: null, toStatus: "planning" }),
      );
    });

    it("upserts the opportunity link when an opportunityId is given (auto-link)", async () => {
      const { db, calls } = fakePrisma();

      await createPocProject(
        { title: "VDI PoC", projectSlug: "demo-project", opportunityId: "opp-1" },
        { prisma: db },
      );

      expect(calls["opportunityLink.upsert"]).toHaveLength(1);
      const linkArgs = calls["opportunityLink.upsert"][0] as {
        where: { opportunityId_entityType_entityId: Record<string, string> };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };
      expect(linkArgs.where.opportunityId_entityType_entityId).toEqual({
        opportunityId: "opp-1",
        entityType: "poc",
        entityId: "poc-1",
      });
      expect(linkArgs.create.linkType).toBe("confirmed");
      expect(linkArgs.update).toEqual({});
    });

    it("returns getPocDetail's result for the newly created POC (deps threaded through)", async () => {
      const { db, calls, setPocDetail } = fakePrisma();
      setPocDetail({ id: "poc-1", title: "Firewall PoC", checklistItems: ["seeded"] });

      const result = await createPocProject({ title: "Firewall PoC", projectSlug: "demo-project" }, { prisma: db });

      const findUniqueArgs = calls["pocProject.findUnique"]?.[0] as { where: { id: string } };
      expect(findUniqueArgs.where).toEqual({ id: "poc-1" });
      expect(result).toEqual({ id: "poc-1", title: "Firewall PoC", checklistItems: ["seeded"] });
    });
  });

  describe("getPocDetail", () => {
    it("queries pocProject.findUnique with the full detail include set", async () => {
      const { db, calls } = fakePrisma();

      await getPocDetail("poc-1", { prisma: db });

      const args = calls["pocProject.findUnique"][0] as {
        where: { id: string };
        include: Record<string, unknown>;
      };
      expect(args.where).toEqual({ id: "poc-1" });
      expect(Object.keys(args.include)).toEqual(
        expect.arrayContaining([
          "customer",
          "partner",
          "checklistItems",
          "issues",
          "requirementRows",
          "events",
          "resultReports",
        ]),
      );
    });
  });
});
