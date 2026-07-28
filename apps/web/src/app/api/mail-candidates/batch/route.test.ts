import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  assertBusinessCapability: vi.fn(async () => null),
}));

vi.mock("@/lib/api-auth", () => ({ assertApiAccess: mocks.assertApiAccess }));
vi.mock("@/lib/auth/authorization", () => ({
  assertBusinessCapability: mocks.assertBusinessCapability,
}));

import { POST } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("POST /api/mail-candidates/batch", () => {
  it("retires blind bulk mutation instead of bypassing per-candidate CAS and idempotency", async () => {
    const response = await POST(new Request("http://localhost/api/mail-candidates/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", minConfidence: 0 }),
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: "batch_mail_candidate_commands_retired",
    });
  });
});
