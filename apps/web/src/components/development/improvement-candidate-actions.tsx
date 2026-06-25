"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  candidateId: string;
  status: string;
  commandRunId?: string | null;
};

export function ImprovementCandidateActions({
  candidateId,
  status,
  commandRunId,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patchStatus(next: "approved" | "rejected") {
    setLoading(next);
    setError(null);
    const res = await fetch(`/api/improvements/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "patch_failed");
    } else {
      router.refresh();
    }
    setLoading(null);
  }

  async function runPhase13() {
    setLoading("run");
    setError(null);
    const res = await fetch(`/api/improvements/${candidateId}/run-phase13`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "run_failed");
    } else {
      router.refresh();
    }
    setLoading(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "proposed" ? (
        <>
          <Button
            size="sm"
            disabled={loading != null}
            onClick={() => patchStatus("approved")}
            type="button"
          >
            {loading === "approved" ? "…" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading != null}
            onClick={() => patchStatus("rejected")}
            type="button"
          >
            {loading === "rejected" ? "…" : "Reject"}
          </Button>
        </>
      ) : null}
      {status === "approved" ? (
        <Button
          size="sm"
          disabled={loading != null}
          onClick={runPhase13}
          type="button"
        >
          {loading === "run" ? "Running…" : "Run Phase 13"}
        </Button>
      ) : null}
      {status === "converted" && commandRunId ? (
        <a
          className="text-sm text-primary hover:underline"
          href={`/development/orchestrator`}
        >
          Command run {commandRunId}
        </a>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
