"use client";

import React, { useState } from "react";

export type EngineerAssignmentControlProps = {
  engagementId: string;
  requirementId: string;
  engineerMembershipId: string;
  expectedRequirementSnapshotHash: string;
  onAssigned?: () => void;
};

export function EngineerAssignmentControl({
  engagementId,
  requirementId,
  engineerMembershipId,
  expectedRequirementSnapshotHash,
  onAssigned,
}: EngineerAssignmentControlProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAssign = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `ea-assign-${Date.now()}`;
      const res = await fetch(`/api/engagements/${engagementId}/engineer-assignments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          requirementId,
          engineerMembershipId,
          expectedRequirementSnapshotHash,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.code || "Assignment failed");
      }

      onAssigned?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3 border rounded bg-zinc-900 text-zinc-100 space-y-2" data-testid="engineer-assignment-control">
      <button
        onClick={handleAssign}
        disabled={submitting}
        className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-xs rounded transition"
        data-testid="btn-assign-engineer"
      >
        Assign Engineer
      </button>
      {error && <p className="text-xs text-rose-400" data-testid="assignment-error">{error}</p>}
    </div>
  );
}
