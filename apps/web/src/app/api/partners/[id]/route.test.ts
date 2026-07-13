import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken } from "@/lib/auth/session";

const { getPartnerDetail, updatePartner, archivePartner } = vi.hoisted(() => ({
  getPartnerDetail: vi.fn(),
  updatePartner: vi.fn(),
  archivePartner: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  prisma: { project: { findFirst: vi.fn(async () => ({ id: "project-a" })) } },
}));

vi.mock("@sangfor/business", () => ({ getPartnerDetail, updatePartner, archivePartner }));

import { DELETE, GET, PATCH } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "test-secret-at-least-16-chars";
  delete process.env.AUTH_BYPASS_ENABLED;
  getPartnerDetail.mockResolvedValue({ id: "partner-b", projectId: "project-b" });
});

function request(method = "GET") {
  const token = createSessionToken({
    id: "user-a",
    email: "user-a@example.com",
    role: "operator",
    projectId: "project-a",
    projectSlug: "alpha",
  });
  return new Request("http://localhost/api/partners/partner-b", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: method === "PATCH" ? JSON.stringify({ name: "Changed" }) : undefined,
  });
}

describe("/api/partners/:id project scope", () => {
  it.each([
    ["GET", GET],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ] as const)("returns 404 for foreign project on %s", async (_method, handler) => {
    const response = await handler(request(_method), { params: Promise.resolve({ id: "partner-b" }) });
    expect(response.status).toBe(404);
  });
});
