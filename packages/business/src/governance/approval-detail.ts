import { createHash } from "node:crypto";
import type { AuthContext } from "@sangfor/auth";
import { withRlsTransaction } from "@sangfor/db";

export class ApprovalDetailError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ApprovalDetailError";
    this.code = code;
    this.httpStatus = status;
  }
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

export type QuoteLineDiff = {
  lineId: string;
  field: string;
  oldValue: string;
  newValue: string;
};

export type ApprovalVersionDiff = {
  kind: "quote" | "document" | "generic";
  hasDiff: boolean;
  quoteLineDiffs?: QuoteLineDiff[];
  textDiff?: { oldText: string; newText: string };
  boundedMetadata?: Record<string, unknown>;
};

export function computeExactQuoteDiff(
  oldVersionContent: any,
  newVersionContent: any,
): QuoteLineDiff[] {
  const diffs: QuoteLineDiff[] = [];
  const oldLines = oldVersionContent?.lines ?? [];
  const newLines = newVersionContent?.lines ?? [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    const lineId = newLine?.id ?? oldLine?.id ?? `line-${i}`;

    for (const field of ["quantity", "unitPrice", "discount", "tax", "lineTotal"]) {
      const oldVal = oldLine?.[field] !== undefined ? String(oldLine[field]) : "";
      const newVal = newLine?.[field] !== undefined ? String(newLine[field]) : "";
      if (oldVal !== newVal) {
        diffs.push({ lineId, field, oldValue: oldVal, newValue: newVal });
      }
    }
  }

  return diffs;
}

export type GetApprovalDetailInput = {
  authContext: AuthContext;
  approvalId: string;
};

export async function getApprovalDetail(input: GetApprovalDetailInput) {
  const { authContext, approvalId } = input;
  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    const approval = await tx.approvalRequest.findUnique({
      where: { id: approvalId },
      include: {
        artifactVersion: { include: { artifact: true } },
        decisions: { orderBy: { sequence: "asc" } },
      },
    });

    if (!approval || approval.companyId !== scope.companyId) {
      throw new ApprovalDetailError("APPROVAL_NOT_FOUND", "Approval request not found", 404);
    }

    // Check if chain is stale, corrupt, or decided
    const isStale = approval.status !== "ready_for_human_approval";
    const isDecided = ["approved", "rejected", "cancelled"].includes(approval.status);

    let versionDiff: ApprovalVersionDiff = { kind: "generic", hasDiff: false };

    // Fetch predecessor version if artifact version exists
    if (approval.artifactVersionId && approval.artifactVersion) {
      const currentVer = approval.artifactVersion;
      if (currentVer.version > 1) {
        const pred = await tx.artifactVersion.findFirst({
          where: { artifactId: currentVer.artifactId, version: currentVer.version - 1 },
        });
        if (pred) {
          const lineDiffs = computeExactQuoteDiff(
            (pred as any).contentJson,
            (currentVer as any).contentJson,
          );
          versionDiff = {
            kind: "quote",
            hasDiff: lineDiffs.length > 0,
            quoteLineDiffs: lineDiffs,
          };
        }
      }
    }

    return {
      approvalId: approval.id,
      status: approval.status,
      revision: approval.revision,
      decisionControlsEnabled: !isStale && !isDecided,
      artifactVersionId: approval.artifactVersionId,
      ownerAssignmentId: approval.ownerAssignmentId,
      decisions: approval.decisions,
      versionDiff,
    };
  });
}
