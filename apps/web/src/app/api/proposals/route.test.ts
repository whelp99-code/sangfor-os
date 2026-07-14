import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateProposal, relatedResourcesBelongToProject } = vi.hoisted(() => ({
  generateProposal: vi.fn(),
  relatedResourcesBelongToProject: vi.fn(),
}));

vi.mock("@sangfor/business", () => ({
  generateProposal,
  listGeneratedDocuments: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ assertApiAccess: vi.fn(() => null) }));

vi.mock("@/lib/project-scope", () => ({
  enforceRequestedProject: vi.fn(() => null),
  relatedResourcesBelongToProject,
  resolveProjectScope: vi.fn(async () => ({
    ok: true,
    scope: { projectId: "project-a", projectSlug: "alpha" },
  })),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  relatedResourcesBelongToProject.mockResolvedValue(false);
});

describe("POST /api/proposals project scope", () => {
  it("rejects a proposal that references a customer from another project", async () => {
    const response = await POST(new Request("http://localhost/api/proposals", {
      method: "POST",
      body: JSON.stringify({ title: "Foreign customer proposal", customerId: "customer-b" }),
    }));

    expect(response.status).toBe(404);
    expect(generateProposal).not.toHaveBeenCalled();
  });
});
