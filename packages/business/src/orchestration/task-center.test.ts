import { describe, it, expect, vi, beforeEach } from "vitest";

// task-center.ts imports prisma directly (no DI seam), so mock @sangfor/db
// at the module level.
vi.mock("@sangfor/db", () => {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown) => (calls[name] ??= []).push(args);

  const findUniqueOrThrow = vi.fn(async (args: { where: { id: string } }) => {
    record("findUniqueOrThrow", args);
    return { id: args.where.id, projectId: "proj-1", status: "todo" };
  });

  const update = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    record("update", args);
    return { id: args.where.id, projectId: "proj-1", ...args.data };
  });

  const findMany = vi.fn(async (args: Record<string, unknown>) => {
    record("findMany", args);
    return [];
  });

  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    record("create", args);
    return { id: "task-1", ...args.data };
  });

  const findFirst = vi.fn(async () => null);

  return {
    prisma: {
      project: { findUniqueOrThrow },
      workTask: { findUniqueOrThrow, update, findMany, create, findFirst, count: findMany },
      taskStatusEvent: { create },
      taskLink: { upsert: vi.fn() },
    },
  };
});
vi.mock("../governance/audit", () => ({ logStateTransition: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../governance/ai-decision", () => ({ recordDecision: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "@sangfor/db";
import {
  archiveWorkTask,
  listTasksByEngagement,
  listTasksForCustomer,
  listTodayTasks,
  listWorkTasks,
  updateWorkTask,
  updateWorkTaskSchema,
} from "./task-center";
import { recordDecision } from "../governance/ai-decision";
import { logStateTransition } from "../governance/audit";

describe("task-center characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("archiveWorkTask", () => {
    it("updates archivedAt to a Date, does NOT call .delete(), and records entity_archive decision", async () => {
      const result = await archiveWorkTask("task-1");

      // Must update with archivedAt, never delete.
      expect(prisma.workTask.delete).toBeUndefined();
      expect(prisma.workTask.update).toHaveBeenCalledTimes(1);
      const updateCall = (prisma.workTask.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(updateCall.where.id).toBe("task-1");
      expect(updateCall.data.archivedAt).toBeInstanceOf(Date);

      // Exactly one recordDecision with entity_archive.
      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "entity_archive",
          projectId: "proj-1",
          caseRef: "task:task-1",
          outcome: "approved",
        }),
      );

      expect(result.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("updateWorkTask — edit capture", () => {
    it("records an entity_edit decision after a plain-field update", async () => {
      const result = await updateWorkTask("task-1", { title: "Updated Title" });

      expect(prisma.workTask.update).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "entity_edit",
          projectId: "proj-1",
          caseRef: "task:task-1",
          outcome: "corrected",
          humanEdit: { title: "Updated Title" },
        }),
      );
      expect(result.title).toBe("Updated Title");
    });

    it("records entity_edit even when status also changes (no transaction needed)", async () => {
      const result = await updateWorkTask("task-1", { title: "New", status: "doing" });

      expect(prisma.workTask.update).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledTimes(1);
      expect(recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: "entity_edit",
          humanEdit: expect.objectContaining({ title: "New", status: "doing" }),
        }),
      );
      expect(logStateTransition).toHaveBeenCalledTimes(1);
      expect(result.title).toBe("New");
    });
  });

  describe("list queries — archivedAt: null inclusion", () => {
    it("listTasksByEngagement includes archivedAt: null in where", async () => {
      await listTasksByEngagement("eng-1");
      const call = (prisma.workTask.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where.archivedAt).toBeNull();
    });

    it("listWorkTasks includes archivedAt: null in where", async () => {
      await listWorkTasks("demo-project");
      const call = (prisma.workTask.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where.archivedAt).toBeNull();
    });

    it("listTasksForCustomer includes archivedAt: null in where", async () => {
      await listTasksForCustomer("cust-1");
      const call = (prisma.workTask.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where.archivedAt).toBeNull();
    });

    it("listTodayTasks includes archivedAt: null in where", async () => {
      await listTodayTasks("demo-project");
      const call = (prisma.workTask.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where.archivedAt).toBeNull();
    });
  });
});
