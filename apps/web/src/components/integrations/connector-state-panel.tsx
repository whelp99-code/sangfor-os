"use client";

import React from "react";
import type { ConnectorState } from "@sangfor/infra";

interface Props {
  state: ConnectorState;
}

export function ConnectorStatePanel({ state }: Props) {
  return (
    <div className="connector-state-panel border rounded p-4" data-testid="connector-state-panel">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-bold text-sm">{state.targetLabel}</h4>
        <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${
          state.state === "connected" ? "bg-green-100 text-green-800" :
          state.state === "degraded" ? "bg-red-100 text-red-800" :
          state.state === "disabled" ? "bg-gray-100 text-gray-800" : "bg-yellow-100 text-yellow-800"
        }`}>
          {state.state}
        </span>
      </div>
      <p className="text-xs text-gray-500 font-mono">Mode: {state.mode} ({state.evidenceClass})</p>
    </div>
  );
}
