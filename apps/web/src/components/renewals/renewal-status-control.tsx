"use client";

import React, { useState } from "react";

type RenewalStatusControlProps = {
  renewalOpportunityId: string;
  status: string;
  updatedAt: string;
  onStatusUpdated?: () => void;
};

const NEXT_STATUS_MAP: Record<string, string> = {
  pending: "notified",
  notified: "quote_requested",
  quote_requested: "vendor_quote",
  vendor_quote: "delivered",
  delivered: "po",
  po: "renewed",
};

export function RenewalStatusControl({
  renewalOpportunityId,
  status,
  updatedAt,
  onStatusUpdated,
}: RenewalStatusControlProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus = NEXT_STATUS_MAP[status];

  const handleTransition = async (targetStatus: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `ren-upd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch(`/api/renewals/${renewalOpportunityId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          expectedStatus: status,
          expectedUpdatedAt: updatedAt,
          nextStatus: targetStatus,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.code || "Failed to update renewal status");
      }

      onStatusUpdated?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-900 text-zinc-100 space-y-4" data-testid="renewal-status-control">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base text-amber-400">Renewal Lifecycle Control</h3>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Current Status: <span className="text-zinc-200 uppercase font-semibold">{status}</span>
          </p>
        </div>
        {nextStatus && (
          <div className="flex gap-2">
            <button
              onClick={() => handleTransition(nextStatus)}
              disabled={submitting}
              className="py-1.5 px-3 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium rounded transition"
              data-testid="btn-advance-status"
            >
              Advance to {nextStatus}
            </button>
            <button
              onClick={() => handleTransition("lost")}
              disabled={submitting}
              className="py-1.5 px-3 text-xs bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-medium rounded transition"
              data-testid="btn-mark-lost"
            >
              Mark Lost
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-rose-400" data-testid="renewal-error">{error}</p>}
    </div>
  );
}
