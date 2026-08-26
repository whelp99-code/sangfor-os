"use client";

import React, { useState } from "react";

type DealGateItem = {
  gateKey: string;
  eligible: boolean;
  blocker?: string;
};

type DealWorkflowPanelProps = {
  opportunityId: string;
  runId?: string;
  gates?: DealGateItem[];
  onWorkflowStarted?: () => void;
};

export function DealWorkflowPanel({
  opportunityId,
  runId,
  gates = [],
  onWorkflowStarted,
}: DealWorkflowPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartWorkflow = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `wf-start-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch(`/api/opportunities/${opportunityId}/workflow-runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.code || "Failed to start deal workflow");
      }

      onWorkflowStarted?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-900 text-zinc-100 space-y-4" data-testid="deal-workflow-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base text-indigo-400">Canonical Deal Workflow Gates</h3>
          {runId && <p className="text-xs text-zinc-400 font-mono">Run: {runId}</p>}
        </div>
        {!runId && (
          <button
            onClick={handleStartWorkflow}
            disabled={submitting}
            className="py-1.5 px-3 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded transition"
            data-testid="btn-start-workflow"
          >
            Start Workflow Run
          </button>
        )}
      </div>

      {error && <p className="text-xs text-rose-400" data-testid="workflow-error">{error}</p>}

      <div className="space-y-2">
        {gates.map((g) => (
          <div key={g.gateKey} className="flex flex-col p-2 bg-zinc-800 border border-zinc-700 rounded text-xs">
            <div className="flex justify-between items-center font-mono">
              <span className="font-semibold text-zinc-200 capitalize">{g.gateKey.replace(/_/g, " ")}</span>
              <span className={g.eligible ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                {g.eligible ? "PASSED" : "BLOCKED"}
              </span>
            </div>
            {g.blocker && <p className="text-amber-400 mt-1">{g.blocker}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
