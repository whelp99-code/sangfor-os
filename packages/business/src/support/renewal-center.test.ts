import { describe, expect, it, vi } from "vitest";
import { getScopedRenewalCenterDetail, updateRenewalCenterLifecycle } from "./renewal-center";

vi.mock("./renewal-projection", () => ({
  getScopedRenewalDetail: vi.fn(async () => ({ id: "ren1", status: "pending" })),
  updateRenewalLifecycle: vi.fn(async () => ({ id: "ren1", status: "notified" })),
}));

const CTX: any = { userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1" };

describe("renewal-center thin adapter unit tests", () => {
  it("delegates detail and lifecycle updates to renewal-projection core service", async () => {
    const detail = await getScopedRenewalCenterDetail(CTX, "ren1");
    expect(detail.id).toBe("ren1");

    const updated = await updateRenewalCenterLifecycle(
      CTX, "ren1", "pending", "2026-07-25T12:00:00Z", "notified", null, "k1", new Date(),
    );
    expect(updated.status).toBe("notified");
  });
});
