"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * AI 의사결정 현황 패널 (S1 슬라이스 2 — 최소 가시화).
 *
 * /api/ai-decisions/stats read-model을 조회해 (actor × actionType) 별
 * 승인/반려/수정 건수 + confidence 버킷(low/med/high)을 보여준다.
 * 데이터 0건이면 정직한 빈상태. 화려하지 않게, 기존 카드 패턴 재사용.
 */

interface ActorActionStat {
  actor: string | null;
  actionType: string | null;
  approved: number;
  rejected: number;
  corrected: number;
  total: number;
}

interface ConfidenceBuckets {
  low: number;
  medium: number;
  high: number;
}

interface DecisionStats {
  byActorAction: ActorActionStat[];
  confidenceBuckets: ConfidenceBuckets;
}

const ACTOR_LABEL: Record<string, string> = {
  sales: "영업",
  presales: "프리세일즈",
  cfo: "CFO",
  marketing: "마케팅",
  engineer: "엔지니어",
  commercial_approval: "상업승인",
  deal_registration: "딜등록",
};

const ACTION_LABEL: Record<string, string> = {
  stage_transition: "단계전이",
  mail_revalidation: "메일 재검증",
  commercial_approval: "상업승인",
};

function label(map: Record<string, string>, key: string | null): string {
  if (!key) return "—";
  return map[key] ?? key;
}

export function AiDecisionPanel() {
  const [data, setData] = useState<DecisionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai-decisions/stats")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.error) setError(String(d.error));
        else setData(d as DecisionStats);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = data?.byActorAction ?? [];
  const buckets = data?.confidenceBuckets;
  const isEmpty = !loading && !error && rows.length === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">AI 의사결정 현황</CardTitle>
        <p className="text-xs text-muted-foreground">
          주체 × 액션타입별 승인/반려/수정 집계 · 예측 신뢰도 분포 (캘리브레이션 토대)
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading && <div className="text-muted-foreground">불러오는 중…</div>}
        {error && <div className="text-destructive">에러: {error}</div>}

        {isEmpty && (
          <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center text-muted-foreground">
            아직 수집된 결정이 없습니다
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-3 font-medium">주체</th>
                    <th className="py-1.5 pr-3 font-medium">액션타입</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-emerald-600">승인</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-amber-600">수정</th>
                    <th className="py-1.5 pr-3 text-right font-medium text-rose-600">반려</th>
                    <th className="py-1.5 text-right font-medium">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={`${row.actor}-${row.actionType}-${i}`} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{label(ACTOR_LABEL, row.actor)}</td>
                      <td className="py-1.5 pr-3">{label(ACTION_LABEL, row.actionType)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-emerald-600">{row.approved}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-amber-600">{row.corrected}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-rose-600">{row.rejected}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {buckets && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">신뢰도 분포</span>
                <Badge variant="secondary">낮음(&lt;0.5) {buckets.low}</Badge>
                <Badge variant="secondary">보통(0.5–0.8) {buckets.medium}</Badge>
                <Badge variant="secondary">높음(≥0.8) {buckets.high}</Badge>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
