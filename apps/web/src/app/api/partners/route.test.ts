import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken } from "@/lib/auth/session";

const { createPartner, listPartners } = vi.hoisted(() => ({
  createPartner: vi.fn(),
  listPartners: vi.fn(async () => []),
}));

vi.mock("@sangfor/db", () => ({
  prisma: { project: { findFirst: vi.fn(async () => ({ id: "project-a" })) } },
}));
vi.mock("@sangfor/business", () => ({ createPartner, listPartners }));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "test-secret-at-least-16-chars";
  delete process.env.AUTH_BYPASS_ENABLED;
});

function request(method = "GET", body?: unknown) {
  const token = createSessionToken({
    id: "user-a",
    email: "user-a@example.com",
    role: "operator",
    projectId: "project-a",
    projectSlug: "alpha",
  });
  return new Request("http://localhost/api/partners", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("/api/partners project scope", () => {
  it("lists only the signed project", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(listPartners).toHaveBeenCalledWith("alpha");
  });

  it("rejects a client supplied foreign project slug", async () => {
    const response = await POST(request("POST", { name: "Foreign", projectSlug: "beta" }));
    expect(response.status).toBe(403);
    expect(createPartner).not.toHaveBeenCalled();
  });
});
