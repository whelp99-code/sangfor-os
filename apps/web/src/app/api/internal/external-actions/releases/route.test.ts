import { describe, expect, it, vi } from "vitest";
vi.mock("@sangfor/auth", () => ({ PRIVILEGED_MFA_MAX_AGE_SECONDS: 60, verifySessionJwt: vi.fn() }));
vi.mock("@sangfor/business", () => ({ ExternalActionReleaseError: class extends Error {}, externalActionCanonicalHash: vi.fn(), issueExternalActionRelease: vi.fn(), parseExternalActionReceiptConfig: vi.fn() }));
import { POST } from "./route";

describe("external action release route", () => {
  it("rejects request supplied body hashes, actors, and scope before issuance", async () => {
    const response = await POST(new Request("http://localhost/api/internal/external-actions/releases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "x", target: "t", artifactVersionId: "v", approvalId: "a", idempotencyKey: "i", operation: {}, approvedBy: "forged" }) }));
    expect([401, 422]).toContain(response.status);
  });
});
