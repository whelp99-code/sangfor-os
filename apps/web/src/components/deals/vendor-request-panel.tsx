"use client";

import React, { useState } from "react";

type VendorRequestItem = {
  id: string;
  requestType: "special_discount" | "demo_license";
  status: string;
  revision: number;
  ownershipRevision: number;
  ownerAssignmentId: string;
  externalReference?: string | null;
  createdAt: string;
};

type VendorRequestPanelProps = {
  opportunityId?: string;
  quoteId?: string;
  requests?: VendorRequestItem[];
  onRequestCreated?: () => void;
};

export function VendorRequestPanel({
  opportunityId,
  quoteId,
  requests = [],
  onRequestCreated,
}: VendorRequestPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRequest = async (requestType: "special_discount" | "demo_license") => {
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `vreq-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const url = quoteId
        ? `/api/quotes/${quoteId}/discount-requests`
        : `/api/opportunities/${opportunityId}/vendor-requests`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ requestType }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.code || "Failed to create vendor request");
      }

      onRequestCreated?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-900 text-zinc-100 space-y-4" data-testid="vendor-request-panel">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base text-cyan-400">Vendor Requests & Discounts</h3>
        <div className="flex space-x-2">
          <button
            onClick={() => handleCreateRequest("special_discount")}
            disabled={submitting}
            className="py-1 px-2.5 text-xs bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded transition"
            data-testid="btn-request-discount"
          >
            + Request Special Discount
          </button>
          <button
            onClick={() => handleCreateRequest("demo_license")}
            disabled={submitting}
            className="py-1 px-2.5 text-xs bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded transition"
            data-testid="btn-request-demo"
          >
            + Request Demo License
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-rose-400" data-testid="request-error">{error}</p>}

      {requests.length === 0 ? (
        <p className="text-xs text-zinc-400">No vendor requests logged for this item.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="p-2.5 bg-zinc-800 border border-zinc-700 rounded text-xs space-y-1">
              <div className="flex justify-between font-mono">
                <span className="font-semibold text-zinc-200">{r.requestType}</span>
                <span className="text-cyan-300 font-medium">{r.status} (r:{r.revision}/o:{r.ownershipRevision})</span>
              </div>
              {r.externalReference && (
                <p className="text-zinc-400">Ref: <span className="font-mono">{r.externalReference}</span></p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
