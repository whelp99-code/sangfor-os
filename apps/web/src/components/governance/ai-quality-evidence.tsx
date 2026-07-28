"use client";

import React, { useState } from "react";

export type AiQualityEvidenceProps = {
  artifactId: string;
  artifactVersionId: string;
  artifactContentHash: string;
  expectedArtifactRevision: number;
  assessmentId: string;
  assessmentResultHash: string;
  qualityPassed: boolean;
  score?: number;
  gaps?: string[];
  slots?: Array<{ slotKey: string; businessRole: string; capability: string; filled: boolean; decision?: string }>;
  onReviewSubmitted?: () => void;
};

export function AiQualityEvidence({
  artifactId,
  artifactVersionId,
  artifactContentHash,
  expectedArtifactRevision,
  assessmentId,
  assessmentResultHash,
  qualityPassed,
  score,
  gaps = [],
  slots = [],
  onReviewSubmitted,
}: AiQualityEvidenceProps) {
  const [submitting, setSubmitting] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleReview = async (decision: "approved" | "rejected") => {
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `rev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch(`/api/artifacts/${artifactId}/quality/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          assessmentId,
          artifactVersionId,
          artifactContentHash,
          assessmentResultHash,
          expectedArtifactRevision,
          decision,
          comment: comment || undefined,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.code || "Failed to submit review");
      }

      setComment("");
      onReviewSubmitted?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-900 text-zinc-100 space-y-4" data-testid="ai-quality-evidence">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg text-emerald-400">AI Quality Governance</h3>
        <span
          className={`px-2 py-1 text-xs rounded font-mono ${
            qualityPassed ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-rose-950 text-rose-300 border border-rose-800"
          }`}
          data-testid="quality-badge"
        >
          {qualityPassed ? "PASSED" : "BLOCKED"} {score !== undefined ? `(${score}pts)` : ""}
        </span>
      </div>

      {gaps.length > 0 && (
        <div className="text-sm text-amber-400 space-y-1">
          <p className="font-medium text-xs text-amber-500 uppercase tracking-wider">Identified Gaps:</p>
          <ul className="list-disc list-inside space-y-1">
            {gaps.map((g, idx) => (
              <li key={idx}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {slots.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-xs text-zinc-400 uppercase tracking-wider">Required Reviews (2-of-2):</p>
          <div className="space-y-1">
            {slots.map((s) => (
              <div key={s.slotKey} className="flex items-center justify-between text-xs p-2 bg-zinc-800 rounded">
                <span className="font-mono text-zinc-300">{s.slotKey} ({s.businessRole})</span>
                <span className={s.filled ? "text-emerald-400" : "text-amber-400 font-semibold"}>
                  {s.filled ? `✓ ${s.decision ?? "filled"}` : "Pending"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-zinc-800">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional review comment (0-1000 chars)..."
          maxLength={1000}
          className="w-full p-2 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-emerald-500"
          disabled={submitting}
        />

        {error && <p className="text-xs text-rose-400" data-testid="review-error">{error}</p>}

        <div className="flex space-x-2">
          <button
            onClick={() => handleReview("approved")}
            disabled={submitting}
            className="flex-1 py-1.5 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded transition"
            data-testid="btn-approve"
          >
            Approve Slot Review
          </button>
          <button
            onClick={() => handleReview("rejected")}
            disabled={submitting}
            className="flex-1 py-1.5 px-3 text-xs bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white font-medium rounded transition"
            data-testid="btn-reject"
          >
            Reject Slot Review
          </button>
        </div>
      </div>
    </div>
  );
}
