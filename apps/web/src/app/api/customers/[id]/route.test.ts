import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken } from "@/lib/auth/session";

const { getCustomerDetail } = vi.hoisted(() => ({ getCustomerDetail: vi.fn() }));

vi.mock("@sangfor/db", () => ({
  prisma: {
    project: { findFirst: vi.fn(async () => ({ id: "project-a" })) },
  },
}));

vi.mock("@sangfor/business", () => ({
  archiveCustomer: vi.fn(),
  getCustomerDetail,
  updateCustomer: vi.fn(),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "test-secret-at-least-16-chars";
  delete process.env.AUTH_BYPASS_ENABLED;
});

function requestFor(projectId: string) {
  const token = createSessionToken({
    id: "user-a",
    email: "user-a@example.com",
    role: "operator",
    projectId,
    projectSlug: "alpha",
  });
  return new Request("http://localhost/api/customers/customer-b", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("GET /api/customers/:id project scope", () => {
  it("returns 404 when the customer belongs to another project", async () => {
    getCustomerDetail.mockResolvedValue({ id: "customer-b", projectId: "project-b" });

    const response = await GET(requestFor("project-a"), {
      params: Promise.resolve({ id: "customer-b" }),
    });

    expect(response.status).toBe(404);
  });
});
