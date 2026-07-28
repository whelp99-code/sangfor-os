"use client";

import React, { useState } from "react";

export type RcaReviewPanelProps = {
  supportCaseId: string;
  rcaArtifactVersionId?: string;
  assessmentStatus?: string;
  qualityPassed?: boolean;
  leadReviewDecision?: "approved" | "rejected" | null;
  archReviewDecision?: "approved" | "rejected" | null;
  approvalStatus?: string;
  status: string;
  revision: number;
  onUpdated?: () => void;
};

export function RcaReviewPanel({
  supportCaseId,
  rcaArtifactVersionId,
  assessmentStatus,
  qualityPassed,
  leadReviewDecision,
  archReviewDecision,
  approvalStatus,
  status,
  revision,
  onUpdated,
}: RcaReviewPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canClose =
    status === "resolved" &&
    qualityPassed === true &&
    leadReviewDecision === "approved" &&
    archReviewDecision === "approved" &&
    approvalStatus === "approved";

  const handleClose = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `close-${Date.now()}`;
      const res = await fetch(`/api/support/${supportCaseId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.code || "Failed to close case");
      }
      onUpdated?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3 border rounded bg-zinc-900 text-zinc-100 space-y-3" data-testid="rca-review-panel">
      <h4 className="font-semibold text-sm text-purple-400">RCA Review Chain</h4>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-zinc-400">AI Quality:</span>
          <span className={`ml-1 font-mono ${qualityPassed ? "text-emerald-400" : "text-rose-400"}`}>
            {assessmentStatus ?? "pending"}
          </span>
        </div>
        <div>
          <span className="text-zinc-400">Support Lead:</span>
          <span className={`ml-1 font-mono ${leadReviewDecision === "approved" ? "text-emerald-400" : "text-amber-400"}`}>
            {leadReviewDecision ?? "pending"}
          </span>
        </div>
        <div>
          <span className="text-zinc-400">Solution Arch:</span>
          <span className={`ml-1 font-mono ${archReviewDecision === "approved" ? "text-emerald-400" : "text-amber-400"}`}>
            {archReviewDecision ?? "pending"}
          </span>
        </div>
        <div>
          <span className="text-zinc-400">Approval:</span>
          <span className={`ml-1 font-mono ${approvalStatus === "approved" ? "text-emerald-400" : "text-amber-400"}`}>
            {approvalStatus ?? "pending"}
          </span>
        </div>
      </div>

      {canClose && (
        <button
          onClick={handleClose}
          disabled={submitting}
          className="w-full py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white font-medium text-xs rounded transition"
          data-testid="btn-close-case"
        >
          Close Case
        </button>
      )}

      {!canClose && status === "resolved" && (
        <p className="text-xs text-amber-400" data-testid="close-blocked">
          Close blocked — complete RCA review chain first.
        </p>
      )}

      {error && <p className="text-xs text-rose-400" data-testid="rca-error">{error}</p>}
    </div>
  );
}
