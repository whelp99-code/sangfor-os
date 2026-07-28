"use client";

import React from "react";

interface Props {
  runs?: Array<{ id: string; jobKey: string; status: string; createdAt: string }>;
}

export function SchedulerHistory({ runs = [] }: Props) {
  return (
    <div className="scheduler-history border rounded p-4" data-testid="scheduler-history">
      <h3 className="text-sm font-bold mb-2">스케줄러 실행 내역</h3>
      {runs.length === 0 ? (
        <p className="text-xs text-gray-500">실행 내역이 없습니다.</p>
      ) : (
        <ul className="space-y-1">
          {runs.map((r) => (
            <li key={r.id} className="text-xs flex justify-between">
              <span>{r.jobKey}</span>
              <span className="font-mono">{r.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
