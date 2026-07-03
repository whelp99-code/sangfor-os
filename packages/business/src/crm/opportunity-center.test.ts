import { describe, it, expect, vi, beforeEach } from "vitest";

// Sibling side-effect modules must never touch the real database in these
// characterization tests — mock them the way domain-persistence.test.ts
// mocks its fake prisma, but at module level since these are separate files.
vi.mock("../audit", () => ({ logStateTransition: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../ai-decision", () => ({ recordDecision: vi.fn().mockResolvedValue(undefined) }));

import {
  createOpportunity,
  listOpportunities,
  updateOpportunity,
  type OpportunityCenterPrisma,
} from "./opportunity-center";
import { logStateTransition } from "../audit";
import { recordDecision } from "../ai-decision";

/** Call-recording fake, following domain-persistence.test.ts's fakePrisma() style. */
function fakePrisma() {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown) => (calls[name] ??= []).push(args);

  let findUniqueOrThrowResult: Record<string, unknown> = {
    id: "opp-1",
    stage: "LEAD",
    projectId: "proj-1",
    dealType: null,
    dealRegistration: null,
  };

  // eslint-disable-next-line prefer-const
  let db: OpportunityCenterPrisma;
  db = {
    project: {
      findUniqueOrThrow: vi.fn(async (args) => {
        record("project.findUniqueOrThrow", args);
        return { id: "proj-1" };
      }),
    },
    opportunity: {
      findMany: vi.fn(async (args) => {
        record("opportunity.findMany", args);
        return [];
      }),
      findUniqueOrThrow: vi.fn(async (args) => {
        record("opportunity.findUniqueOrThrow", args);
        return findUniqueOrThrowResult;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        record("opportunity.create", args);
        return { id: "opp-1", ...args.data };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        record("opportunity.update", args);
        return { id: args.where.id, ...args.data };
      }),
    },
    opportunityStageEvent: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        record("opportunityStageEvent.create", args);
        return { id: "evt-1", ...args.data };
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $queryRaw: vi.fn(async () => [{ nextval: 1n }]) as any,
    // $transaction just invokes the callback with the same fake db, mirroring
    // how a Prisma interactive-transaction client shares its model shape.
    $transaction: vi.fn(async (fn) => fn(db)),
  };

  return {
    db,
    calls,
    setFindUniqueOrThrowResult(row: Record<string, unknown>) {
      findUniqueOrThrowResult = row;
    },
  };
}

describe("opportunity-center characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listOpportunities", () => {
    it("resolves the project by slug and lists opportunities scoped to it", async () => {
      const { db, calls } = fakePrisma();

      const result = await listOpportunities("demo-project", { prisma: db });

      expect(calls["project.findUniqueOrThrow"]?.[0]).toEqual({ where: { slug: "demo-project" } });
      const findManyArgs = calls["opportunity.findMany"]?.[0] as {
        where: { projectId: string };
        orderBy: { updatedAt: string };
        include: Record<string, unknown>;
      };
      expect(findManyArgs.where.projectId).toBe("proj-1");
      expect(findManyArgs.orderBy).toEqual({ updatedAt: "desc" });
      expect(Object.keys(findManyArgs.include)).toEqual(
        expect.arrayContaining(["customer", "partner", "links", "dealRegistration"]),
      );
      // characterization: the function returns whatever findMany resolves (the fake's default: []).
      expect(result).toEqual([]);
    });
  });

  describe("createOpportunity", () => {
    it("creates the opportunity row, a creation stage event, and audits it", async () => {
      const { db, calls } = fakePrisma();

      const opp = await createOpportunity({ title: "Test Deal", projectSlug: "demo-project" }, { prisma: db });

      expect(calls["project.findUniqueOrThrow"]?.[0]).toEqual({ where: { slug: "demo-project" } });
      expect(calls["opportunity.create"]).toHaveLength(1);
      const createArgs = calls["opportunity.create"][0] as { data: Record<string, unknown> };
      expect(createArgs.data.title).toBe("Test Deal");
      expect(createArgs.data.stage).toBe("LEAD");
      expect(createArgs.data.code).toMatch(new RegExp(`^PRJ-${new Date().getFullYear()}-0001$`));

      const stageEventArgs = calls["opportunityStageEvent.create"][0] as { data: Record<string, unknown> };
      expect(stageEventArgs.data.toStage).toBe("LEAD");
      expect(stageEventArgs.data.note).toBe("Opportunity created");

      expect(logStateTransition).toHaveBeenCalledTimes(1);
      expect(logStateTransition).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "opportunity", fromStatus: null, toStatus: "LEAD" }),
      );

      expect(opp.id).toBe("opp-1");
    });
  });

  describe("updateOpportunity", () => {
    it("advances a legal stage transition via a transaction and records both audits", async () => {
      const { db, calls } = fakePrisma();

      const updated = await updateOpportunity("opp-1", { stage: "QUALIFIED" }, { prisma: db });

      expect(calls["opportunity.update"]).toHaveLength(1);
      const updateArgs = calls["opportunity.update"][0] as { data: Record<string, unknown> };
      expect(updateArgs.data.stage).toBe("QUALIFIED");

      const stageEventArgs = calls["opportunityStageEvent.create"][0] as { data: Record<string, unknown> };
      expect(stageEventArgs.data.fromStage).toBe("LEAD");
      expect(stageEventArgs.data.toStage).toBe("QUALIFIED");

      expect(logStateTransition).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: "stage_transition", outcome: "approved" }),
      );
      expect(updated.stage).toBe("QUALIFIED");
    });

    it("rejects an illegal stage transition and performs no writes", async () => {
      const { db, calls } = fakePrisma();
      db.opportunity.findUniqueOrThrow = vi.fn(async () => ({
        id: "opp-1",
        stage: "WON",
        projectId: "proj-1",
        dealType: null,
        dealRegistration: null,
      }));

      await expect(updateOpportunity("opp-1", { stage: "LEAD" }, { prisma: db })).rejects.toThrow(
        /^illegal_stage_transition:/,
      );

      expect(calls["opportunity.update"]).toBeUndefined();
      expect(calls["opportunityStageEvent.create"]).toBeUndefined();
      expect(logStateTransition).not.toHaveBeenCalled();
      expect(recordDecision).not.toHaveBeenCalled();
    });

    it("applies a plain field update with no stage change directly (no transaction)", async () => {
      const { db, calls } = fakePrisma();

      const updated = await updateOpportunity("opp-1", { title: "New Title" }, { prisma: db });

      expect(calls["opportunity.update"]).toHaveLength(1);
      const updateArgs = calls["opportunity.update"][0] as { data: Record<string, unknown> };
      expect(updateArgs.data.title).toBe("New Title");
      expect(calls["opportunityStageEvent.create"]).toBeUndefined();

      expect(logStateTransition).not.toHaveBeenCalled();
      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: "entity_edit", outcome: "corrected" }),
      );
      expect(updated.title).toBe("New Title");
    });
  });
});
