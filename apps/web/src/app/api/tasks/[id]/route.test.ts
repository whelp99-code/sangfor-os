import { beforeEach, describe, expect, it, vi } from "vitest";

const { linkTaskToEntity, relatedResourcesBelongToProject } = vi.hoisted(() => ({
  linkTaskToEntity: vi.fn(),
  relatedResourcesBelongToProject: vi.fn(),
}));

vi.mock("@sangfor/business", () => ({
  archiveWorkTask: vi.fn(),
  getWorkTaskDetail: vi.fn(async () => ({ id: "task-a", projectId: "project-a" })),
  linkTaskToEntity,
  updateWorkTask: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  apiError: vi.fn(),
  assertApiAccess: vi.fn(() => null),
}));

vi.mock("@/lib/project-scope", () => ({
  isResourceInProject: vi.fn(() => true),
  relatedResourcesBelongToProject,
  resolveProjectScope: vi.fn(async () => ({
    ok: true,
    scope: { projectId: "project-a", projectSlug: "alpha" },
  })),
}));

import { PATCH } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  relatedResourcesBelongToProject.mockResolvedValue(false);
});

describe("PATCH /api/tasks/:id project scope", () => {
  it("rejects a generic link to an entity from another project", async () => {
    const response = await PATCH(new Request("http://localhost/api/tasks/task-a", {
      method: "PATCH",
      body: JSON.stringify({ entityType: "customer", entityId: "customer-b" }),
    }), { params: Promise.resolve({ id: "task-a" }) });

    expect(response.status).toBe(404);
    expect(linkTaskToEntity).not.toHaveBeenCalled();
  });
});
