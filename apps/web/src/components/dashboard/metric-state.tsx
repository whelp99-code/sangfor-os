import React from "react";
import type { MetricCell } from "@sangfor/business";

interface Props {
  label: string;
  metric: MetricCell;
}

export function MetricState({ label, metric }: Props) {
  const isMeasured = metric.state === "MEASURED";
  const stateLabels: Record<string, string> = {
    MEASURED: "측정됨",
    PARTIAL: "부분 수집",
    UNKNOWN: "확인 불가",
    COLLECTING: "수집 중",
    SOURCE_UNAVAILABLE: "소스 연결 불가",
  };

  return (
    <div className="metric-state-card border rounded p-4 flex flex-col justify-between" data-testid="metric-state">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold my-2">
        {isMeasured ? (
          <span>{String(metric.value)} {metric.unit ?? ""}</span>
        ) : (
          <span className="text-amber-600 text-sm font-normal">{stateLabels[metric.state] ?? metric.state}</span>
        )}
      </div>
      {metric.reason && !isMeasured && (
        <div className="text-xs text-amber-700 font-mono">{metric.reason}</div>
      )}
    </div>
  );
}
