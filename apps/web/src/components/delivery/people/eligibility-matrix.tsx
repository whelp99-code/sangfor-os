"use client";

import React from "react";

export type EligibilityMatrixProps = {
  people: Array<{
    id: string;
    userId: string;
    role: string;
    status: string;
    eligible?: boolean;
    blockers?: string[];
  }>;
};

export function EligibilityMatrix({ people }: EligibilityMatrixProps) {
  return (
    <div className="p-4 border rounded-lg bg-zinc-900 text-zinc-100 space-y-3" data-testid="eligibility-matrix">
      <h3 className="font-semibold text-sm text-cyan-400">Delivery Engineer Eligibility Matrix</h3>
      <div className="space-y-2">
        {people.map((p) => (
          <div key={p.id} className="flex items-center justify-between p-2 rounded bg-zinc-800 text-xs">
            <div>
              <span className="font-mono text-zinc-200">{p.userId}</span>
              <span className="ml-2 text-zinc-400">({p.role})</span>
            </div>
            <div>
              {p.eligible !== false ? (
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-semibold" data-testid="status-eligible">
                  Eligible
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 font-semibold" data-testid="status-blocked">
                  Blocked: {p.blockers?.join(", ")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
