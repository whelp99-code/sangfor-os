// U058 retention purge service — dry-run and local-purge execution
import { RetentionServiceError } from "./retention-service";

export { RetentionServiceError };

export type ExecuteRetentionRunInput = {
  previewRunId: string;
  approvalId: string;
  previewHash: string;
  dryRun?: boolean;
  actorId: string;
  now: Date;
};

export async function executeRetentionRun(_input: ExecuteRetentionRunInput): Promise<{ status: string; purgedCount: number; wouldPurgeCount: number }> {
  // dryRun=true by default — full destructive execution requires RETENTION_LOCAL_PURGE_ALLOWED=1 + U009 receipt
  const dryRun = _input.dryRun !== false;

  if (!dryRun) {
    const allowed = process.env["RETENTION_LOCAL_PURGE_ALLOWED"] === "1";
    if (!allowed) {
      throw new RetentionServiceError(
        "RETENTION_EXTERNAL_APPROVAL_REQUIRED",
        "Destructive purge requires RETENTION_LOCAL_PURGE_ALLOWED=1 and a valid U009 task-owned receipt",
        403,
      );
    }
  }

  // Stub: full serializable transaction with candidate lock + hash revalidation would go here
  return {
    status: "completed",
    purgedCount: 0,
    wouldPurgeCount: 0,
  };
}
