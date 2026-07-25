"use client";

import React, { useState } from "react";

export type SupportCaseActionsProps = {
  supportCaseId: string;
  status: string;
  revision: number;
  onStatusUpdated?: () => void;
};

export function SupportCaseActions({
  supportCaseId,
  status,
  revision,
  onStatusUpdated,
}: SupportCaseActionsProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (action: "respond" | "resolve") => {
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `sc-act-${Date.now()}`;
      const res = await fetch(`/api/support/${supportCaseId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ action, expectedRevision: revision }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.code || "Failed to update case status");
      }

      onStatusUpdated?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3 border rounded bg-zinc-900 text-zinc-100 space-y-2" data-testid="support-case-actions">
      <div className="flex gap-2">
        {status === "open" && (
          <button
            onClick={() => handleAction("respond")}
            disabled={submitting}
            className="py-1.5 px-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-xs rounded transition"
            data-testid="btn-respond"
          >
            Respond (In Progress)
          </button>
        )}
        {status === "in_progress" && (
          <button
            onClick={() => handleAction("resolve")}
            disabled={submitting}
            className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs rounded transition"
            data-testid="btn-resolve"
          >
            Resolve Case
          </button>
        )}
      </div>
      {error && <p className="text-xs text-rose-400" data-testid="support-error">{error}</p>}
    </div>
  );
}
