"use client";

import React, { useState } from "react";

type DeliveryAcceptancePanelProps = {
  engagementId: string;
  quoteId?: string;
  artifactVersionId?: string;
  acceptanceId?: string;
  acceptedAt?: string;
  onAccepted?: () => void;
};

export function DeliveryAcceptancePanel({
  engagementId,
  quoteId = "",
  artifactVersionId = "",
  acceptanceId,
  acceptedAt,
  onAccepted,
}: DeliveryAcceptancePanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `acc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch(`/api/engagements/${engagementId}/acceptance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ quoteId, artifactVersionId }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.code || "Failed to accept delivery projection");
      }

      onAccepted?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-900 text-zinc-100 space-y-4" data-testid="delivery-acceptance-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base text-emerald-400">Atomic Delivery Acceptance</h3>
          {acceptanceId && (
            <p className="text-xs text-zinc-400 font-mono mt-1">
              Accepted ID: {acceptanceId} ({acceptedAt})
            </p>
          )}
        </div>
        {!acceptanceId && (
          <button
            onClick={handleAccept}
            disabled={submitting || !quoteId || !artifactVersionId}
            className="py-1.5 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded transition"
            data-testid="btn-accept-delivery"
          >
            Accept &amp; Project Assets
          </button>
        )}
      </div>

      {error && <p className="text-xs text-rose-400" data-testid="acceptance-error">{error}</p>}

      <div className="text-xs text-zinc-300 space-y-1 font-mono">
        <p>Quote ID: {quoteId || "N/A"}</p>
        <p>Artifact Version: {artifactVersionId || "N/A"}</p>
      </div>
    </div>
  );
}
