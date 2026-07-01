"use client";

import { useState } from "react";

import { actionErrorMessage } from "@/lib/action-error-labels";

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
      setError(actionErrorMessage(err instanceof Error ? err.message : "failed_to_promote"));
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
            <h3 className="text-sm font-semibold tracking-tight">메일 인텔리전스 정책</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              운영에서 도출된 사용자 정의 규칙(내부 회사, 파트너, 시스템 발신자)을 관리합니다.
            </p>
          </div>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
              제안된 필터 ({proposed.length})
            </span>
            {proposed.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">검토 대기 중인 제안 정책이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {proposed.map((policy) => (
                  <div
                    key={policy.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md border border-amber-200/50 bg-amber-500/5 text-xs"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-mono text-xs font-bold">
                          {policy.memoryType}
                        </span>
                        <span className="font-medium text-foreground break-all">{policy.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        출처: {policy.source} · 신뢰도: {policy.confidence}% · 키: {policy.key}
                      </p>
                    </div>
                    <button
                      disabled={loadingId === policy.id}
                      onClick={() => handlePromote(policy.id)}
                      type="button"
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium text-[11px] disabled:opacity-50 transition-colors"
                    >
                      {loadingId === policy.id ? "활성화 중..." : "활성화"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-border">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
              활성 필터 ({active.length})
            </span>
            {active.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">로드된 활성 정책 필터가 없습니다.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {active.map((policy) => (
                  <div
                    key={policy.id}
                    className="p-2.5 rounded-md border border-border bg-muted/30 text-xs flex flex-col gap-1"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-xs border border-border">
                        {policy.memoryType}
                      </span>
                      <span className="font-medium text-foreground truncate" title={policy.label}>
                        {policy.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      출처: {policy.source} · 신뢰도: {policy.confidence}%
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
