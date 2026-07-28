"use client";

import { useEffect, useState } from "react";
import type { BusinessRoleDashboardPayload } from "@sangfor/business";
import type { BusinessRole } from "@sangfor/auth";

import { MetricState } from "./metric-state";

const METRIC_LABELS: Record<string, string> = {
  activeOpportunities: "활성 영업기회",
  systemTelemetry: "시스템 텔레메트리",
};

export function BusinessRoleDashboardPanel({ role }: { role: BusinessRole }) {
  const [data, setData] = useState<BusinessRoleDashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dashboard/${role}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<BusinessRoleDashboardPayload>;
      })
      .then(setData)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "대시보드를 불러오지 못했습니다");
      });
    return () => controller.abort();
  }, [role]);

  if (error) {
    return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  }
  if (!data) {
    return <div aria-label="대시보드 로딩 중" className="h-40 animate-pulse rounded-2xl bg-muted" />;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Object.entries(data.metrics).map(([key, metric]) => (
        <MetricState key={key} label={METRIC_LABELS[key] ?? key} metric={metric} />
      ))}
    </div>
  );
}
