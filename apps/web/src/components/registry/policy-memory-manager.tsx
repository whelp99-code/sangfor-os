"use client";

import { useState } from "react";

type PolicyMemory = {
  id: string;
  memoryType: string;
  key: string;
  label: string;
  source: string;
  confidence: number;
  status: string;
};

export function PolicyMemoryManager({
  initialPolicies,
}: {
  initialPolicies: PolicyMemory[];
}) {
  const [policies, setPolicies] = useState<PolicyMemory[]>(initialPolicies);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePromote(id: string) {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/policy-memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed_to_promote");

      // Update state
      setPolicies((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "active" } : p))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_promote");
    } finally {
      setLoadingId(null);
    }
  }

  const proposed = policies.filter((p) => p.status === "proposed");
  const active = policies.filter((p) => p.status === "active");

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card shadow-sm">
        <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Mail Intelligence Policies</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage custom rules (internal companies, partners, system senders) derived from operations.
            </p>
          </div>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
              Proposed Filters ({proposed.length})
            </span>
            {proposed.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No proposed policies pending review.</p>
            ) : (
              <div className="space-y-2">
                {proposed.map((policy) => (
                  <div
                    key={policy.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md border border-amber-200/50 bg-amber-500/5 text-xs"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-mono text-[10px] font-bold">
                          {policy.memoryType}
                        </span>
                        <span className="font-medium text-foreground break-all">{policy.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Source: {policy.source} · Confidence: {policy.confidence}% · Key: {policy.key}
                      </p>
                    </div>
                    <button
                      disabled={loadingId === policy.id}
                      onClick={() => handlePromote(policy.id)}
                      type="button"
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium text-[11px] disabled:opacity-50 transition-colors"
                    >
                      {loadingId === policy.id ? "Promoting..." : "Activate"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-border">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
              Active Filters ({active.length})
            </span>
            {active.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No active policy filters loaded.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {active.map((policy) => (
                  <div
                    key={policy.id}
                    className="p-2.5 rounded-md border border-border bg-muted/30 text-xs flex flex-col gap-1"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-[10px] border border-border">
                        {policy.memoryType}
                      </span>
                      <span className="font-medium text-foreground truncate" title={policy.label}>
                        {policy.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Source: {policy.source} · Confidence: {policy.confidence}%
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
