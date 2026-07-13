import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken } from "@/lib/auth/session";

const { getContactDetail, updateContact, archiveContact } = vi.hoisted(() => ({
  getContactDetail: vi.fn(),
  updateContact: vi.fn(),
  archiveContact: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  prisma: { project: { findFirst: vi.fn(async () => ({ id: "project-a" })) } },
}));

vi.mock("@sangfor/business", () => ({ getContactDetail, updateContact, archiveContact }));

import { DELETE, GET, PATCH } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "test-secret-at-least-16-chars";
  delete process.env.AUTH_BYPASS_ENABLED;
  getContactDetail.mockResolvedValue({
    id: "contact-b",
    customer: { projectId: "project-b" },
    partner: null,
  });
});

function request(method = "GET") {
  const token = createSessionToken({
    id: "user-a",
    email: "user-a@example.com",
    role: "operator",
    projectId: "project-a",
    projectSlug: "alpha",
  });
  return new Request("http://localhost/api/contacts/contact-b", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: method === "PATCH" ? JSON.stringify({ name: "Changed" }) : undefined,
  });
}

describe("/api/contacts/:id project scope", () => {
  it.each([
    ["GET", GET],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ] as const)("returns 404 for foreign project on %s", async (_method, handler) => {
    const response = await handler(request(_method), { params: Promise.resolve({ id: "contact-b" }) });
    expect(response.status).toBe(404);
  });
});
