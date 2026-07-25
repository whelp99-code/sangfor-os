import { describe, expect, it } from "vitest";
import { executeRetentionRun, RetentionServiceError } from "./retention-purge";

describe("U058: retention-purge unit tests", () => {
  it("rejects dryRun=false without RETENTION_LOCAL_PURGE_ALLOWED=1", async () => {
    delete process.env["RETENTION_LOCAL_PURGE_ALLOWED"];
    await expect(
      executeRetentionRun({
        previewRunId: "run1", approvalId: "apr1", previewHash: "a".repeat(64),
        dryRun: false, actorId: "u1", now: new Date(),
      }),
    ).rejects.toThrow(RetentionServiceError);
  });

  it("dryRun=true returns purgedCount=0", async () => {
    const result = await executeRetentionRun({
      previewRunId: "run1", approvalId: "apr1", previewHash: "a".repeat(64),
      dryRun: true, actorId: "u1", now: new Date(),
    });
    expect(result.status).toBe("completed");
    expect(result.purgedCount).toBe(0);
  });
});
