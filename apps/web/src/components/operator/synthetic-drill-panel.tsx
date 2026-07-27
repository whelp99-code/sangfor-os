"use client";

import React, { useState } from "react";
import type { DrillScenario, DrillRunResult } from "@sangfor/business";

export function SyntheticDrillPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DrillRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDrill = async (scenario: DrillScenario) => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/operator/drills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, idempotencyKey: `drill-ui-${Date.now()}` }),
      });
      const data = await res.json();
      if (Array.isArray(data.phases)) {
        setResult(data);
      } else {
        setResult(null);
        setError(data.error ?? "드릴 실행에 실패했습니다.");
      }
    } catch {
      setResult(null);
      setError("드릴 실행 서버에 연결할 수 없습니다.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="synthetic-drill-panel border rounded p-4 space-y-4" data-testid="synthetic-drill-panel">
      <h3 className="font-bold text-base">오퍼레이터 합성 복구 드릴 (Synthetic Remediation Drills)</h3>
      <div className="flex space-x-2">
        <button
          disabled={running}
          onClick={() => runDrill("stuck-approval")}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Stuck Approval 드릴
        </button>
        <button
          disabled={running}
          onClick={() => runDrill("missing-rls-context")}
          className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50"
        >
          RLS Context 누락 드릴
        </button>
        <button
          disabled={running}
          onClick={() => runDrill("ai-cost-spike")}
          className="px-3 py-1.5 bg-amber-800 text-white text-xs rounded hover:bg-amber-900 disabled:opacity-50"
        >
          AI Cost Spike 드릴
        </button>
      </div>

      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}

      {result && (
        <div className="bg-gray-50 p-3 rounded text-xs space-y-2">
          <div className="font-semibold">결과: {result.status} ({result.scenario})</div>
          <ol className="list-decimal list-inside space-y-1 font-mono text-gray-700">
            {result.phases.map((p) => (
              <li key={p.phase}>
                [{p.status}] <span className="font-semibold">{p.phase}</span>: {p.details}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
