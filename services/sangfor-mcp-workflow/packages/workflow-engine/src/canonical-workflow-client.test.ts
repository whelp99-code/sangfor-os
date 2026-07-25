import { describe, expect, it, vi } from "vitest";
import { CanonicalWorkflowClient } from "./canonical-workflow-client.js";

const VALID_ENV = {
  SANGFOR_ROOT_URL: "http://localhost:3101",
  INTERNAL_PRINCIPAL_TTL_SECONDS: "60",
  INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: "5",
  INTERNAL_PRINCIPAL_ROTATION_OWNER: "security-auth",
  INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: "wf-key-1",
  INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: JSON.stringify({
    version: "sangfor.internal-principal-keyring/v1",
    keys: [
      {
        kid: "wf-key-1",
        state: "active",
        secretBase64Url: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE", // exactly 32 bytes 'a's base64url
      },
    ],
  }),
};

const VALID_SCOPE = {
  tenantId: "t1", companyId: "c1", projectId: "p1",
};

describe("CanonicalWorkflowClient", () => {
  it("starts deal workflow run via canonical root API", async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ run: { runId: "run1" } }), { status: 200 }));

    const client = new CanonicalWorkflowClient({
      environment: VALID_ENV,
      scope: VALID_SCOPE,
      fetch: mockFetch as any,
    });

    const res = await client.startDealWorkflow("opp1", "k1");
    expect(res).toEqual({ runId: "run1" });
    expect(mockFetch).toHaveBeenCalled();
  });
});
