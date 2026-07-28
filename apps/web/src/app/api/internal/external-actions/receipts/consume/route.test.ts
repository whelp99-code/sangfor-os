import { describe, expect, it, vi } from "vitest";
vi.mock("@sangfor/auth", () => ({ INTERNAL_PRINCIPAL_HEADER: "x-sangfor-internal-principal", verifyInternalPrincipal: vi.fn() }));
vi.mock("@sangfor/config", () => ({ getInternalPrincipalConfig: vi.fn() }));
vi.mock("@sangfor/business", () => ({ ExternalActionReleaseError: class extends Error {}, consumeExternalActionRelease: vi.fn(), parseExternalActionReceiptConfig: vi.fn(), verifyExternalActionReceipt: vi.fn() }));
import { POST } from "./route";

describe("external action consume route", () => {
  it("rejects ambient bearer authorization without a signed ENGINEER principal", async () => {
    const response = await POST(new Request("http://localhost/api/internal/external-actions/receipts/consume", { method: "POST", headers: { authorization: "Bearer ambient", "content-type": "application/json" }, body: JSON.stringify({ receipt: "forged" }) }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_INTERNAL_PRINCIPAL" });
  });
});
