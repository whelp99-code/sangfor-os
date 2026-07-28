"use client";

import React, { useState } from "react";

interface Props {
  targetId: string;
  onReprobed?: () => void;
}

export function OperatorRemediationControls({ targetId, onReprobed }: Props) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleReprobe() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/operator/remediations/reprobe-target", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `reprobe-${targetId}-${Date.now()}`.padEnd(16, "0"),
        },
        body: JSON.stringify({ targetId }),
      });
      if (!res.ok) throw new Error("재측정 실패");
      setMsg("재측정 완료");
      onReprobed?.();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="operator-remediation-controls flex items-center gap-2" data-testid="remediation-controls">
      <button
        className="btn-reprobe px-3 py-1 text-xs border rounded bg-slate-100 hover:bg-slate-200"
        onClick={handleReprobe}
        disabled={loading}
      >
        {loading ? "측정 중..." : "재측정"}
      </button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </div>
  );
}
