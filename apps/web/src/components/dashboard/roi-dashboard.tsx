import React from "react";
import { MetricState } from "./metric-state";

interface Props {
  data?: {
    metrics?: Array<{
      metricKey: string;
      displayName: string;
      unit: string;
      state: any;
      value: number | null;
      asOf: string;
      sourceCount: number;
      warnings: string[];
    }>;
  };
}

export function RoiDashboard({ data }: Props) {
  const metrics = data?.metrics || [];

  return (
    <div className="roi-dashboard space-y-4 p-4" data-testid="roi-dashboard">
      <h1 className="text-xl font-bold">ROI &amp; 경제성 대시보드</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {metrics.map((m) => (
          <MetricState
            key={m.metricKey}
            label={m.displayName}
            metric={{
              state: m.state,
              value: m.value,
              unit: m.unit,
              reason: m.warnings[0],
              provenance: [`asOf: ${m.asOf}`, `sources: ${m.sourceCount}`],
            }}
          />
        ))}
      </div>
    </div>
  );
}

