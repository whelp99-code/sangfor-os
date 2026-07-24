import { describe, expect, it } from "vitest";
import {
  publishSizingTemplate,
  publishCompatibilityRule,
  CatalogRuleServiceError,
} from "./catalog-rule-service";

describe("Catalog Rule Service Unit Tests", () => {
  const mockCaller = {
    userId: "user-admin",
    sessionId: "sess-1",
    mfaVerifiedAt: new Date(),
    scope: {
      level: "COMPANY" as const,
      tenantId: "tenant-a",
      companyId: "company-a",
      projectId: "project-a",
    },
  };

  it("rejects caller provided action override during publish", async () => {
    await expect(
      publishSizingTemplate(
        mockCaller,
        "sizing-1",
        {
          artifactVersionId: "ver-1",
          approvalId: "app-1",
          expectedActiveArtifactVersionId: null,
          action: "malicious.action.override",
        } as any
      )
    ).rejects.toThrow(CatalogRuleServiceError);
  });

  it("rejects caller provided action override during compatibility publish", async () => {
    await expect(
      publishCompatibilityRule(
        mockCaller,
        "rule-1",
        {
          artifactVersionId: "ver-1",
          approvalId: "app-1",
          expectedActiveArtifactVersionId: null,
          action: "malicious.action.override",
        } as any
      )
    ).rejects.toThrow(CatalogRuleServiceError);
  });
});
