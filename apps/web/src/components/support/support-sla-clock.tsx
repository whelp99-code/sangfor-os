"use client";

import React from "react";

type SupportSlaClockProps = {
  severity: string;
  responseDueAt?: string;
  resolutionDueAt?: string;
  respondedAt?: string;
  resolvedAt?: string;
};

export function SupportSlaClock({
  severity,
  responseDueAt,
  resolutionDueAt,
  respondedAt,
  resolvedAt,
}: SupportSlaClockProps) {
  return (
    <div className="p-3 border rounded bg-zinc-900 text-zinc-100 space-y-2" data-testid="support-sla-clock">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-xs text-amber-400 uppercase">SLA Clock ({severity})</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div>
          <span className="text-zinc-400">Response Due:</span>
          <p className="text-zinc-200">{responseDueAt ? new Date(responseDueAt).toLocaleTimeString() : "N/A"}</p>
          {respondedAt && <p className="text-emerald-400 text-[10px]">Responded</p>}
        </div>
        <div>
          <span className="text-zinc-400">Resolution Due:</span>
          <p className="text-zinc-200">{resolutionDueAt ? new Date(resolutionDueAt).toLocaleTimeString() : "N/A"}</p>
          {resolvedAt && <p className="text-emerald-400 text-[10px]">Resolved</p>}
        </div>
      </div>
    </div>
  );
}
