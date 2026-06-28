"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DomainRow {
  domain: string;
  label: string;
  produces: string;
  handoffTo: string | null;
  requiredLenses: string[];
  ownedEntities: string[];
  memoryCount: number;
  decisionCount: number;
  lastDecisionAt: string | null;
  lastOutcome: string | null;
}

interface Snapshot {
  pipeline: string[];
  rows: DomainRow[];
  totals: { memories: number; decisions: number };
}

const LENS_BG: Record<string, string> = {
  blue: "bg-blue-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  gray: "bg-gray-400",
  teal: "bg-teal-500",
  purple: "bg-purple-500",
};

function outcomeVariant(outcome: string | null): "default" | "destructive" | "secondary" {
  if (outcome === "approved") return "default";
  if (outcome === "rejected") return "destructive";
  return "secondary";
}

export default function DomainPipelinePage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/domain-pipeline")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">종축 도메인 파이프라인</h1>
        <p className="text-sm text-muted-foreground">
          마케팅 → 영업 → 프리세일즈 → 엔지니어 → CFO · 각 도메인 × 컬러 렌즈 · 도메인별 학습/결정
        </p>
      </div>

      {loading && <div className="text-sm text-muted-foreground">불러오는 중…</div>}
      {error && <div className="text-sm text-destructive">에러: {error}</div>}

      {data && (
        <>
          <div className="flex gap-3 text-sm">
            <Badge variant="secondary">메모리 {data.totals.memories}건</Badge>
            <Badge variant="secondary">결정로그 {data.totals.decisions}건</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.rows.map((row, i) => (
              <Card key={row.domain}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>
                      <span className="mr-2 text-muted-foreground">{i + 1}</span>
                      {row.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      → {row.handoffTo ?? "완료"}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs text-muted-foreground">렌즈</span>
                    {row.requiredLenses.map((lens) => (
                      <span
                        key={lens}
                        className={`inline-block h-3 w-3 rounded-full ${LENS_BG[lens] ?? "bg-foreground/30"}`}
                        title={lens}
                      />
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">산출물: {row.produces}</div>
                  <div className="text-xs text-muted-foreground">
                    소유 데이터: {row.ownedEntities.join(", ")}
                  </div>
                  <div className="flex items-center justify-between border-t pt-2">
                    <span>메모리 {row.memoryCount} · 결정 {row.decisionCount}</span>
                    {row.lastOutcome && (
                      <Badge variant={outcomeVariant(row.lastOutcome)}>{row.lastOutcome}</Badge>
                    )}
                  </div>
                  {row.lastDecisionAt && (
                    <div className="text-xs text-muted-foreground">
                      최근 결정: {new Date(row.lastDecisionAt).toLocaleString("ko-KR")}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
