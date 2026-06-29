"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface OutcomeBreakdown {
  approved: number;
  rejected: number;
  corrected: number;
}

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
  outcomeBreakdown: OutcomeBreakdown;
  recentDecisions: { outcome: string | null; at: string }[];
}

interface Snapshot {
  pipeline: string[];
  rows: DomainRow[];
  totals: { memories: number; decisions: number; approved: number; rejected: number; corrected: number };
  generatedAt: string;
}

const LENS_BG: Record<string, string> = {
  blue: "bg-blue-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  gray: "bg-gray-400",
  teal: "bg-teal-500",
  purple: "bg-purple-500",
};

const OUTCOME_BG: Record<string, string> = {
  approved: "bg-emerald-500",
  rejected: "bg-rose-500",
  corrected: "bg-amber-500",
};

const OUTCOME_TEXT: Record<string, string> = {
  approved: "text-emerald-600",
  rejected: "text-rose-600",
  corrected: "text-amber-600",
};

function outcomeVariant(outcome: string | null): "default" | "destructive" | "secondary" {
  if (outcome === "approved") return "default";
  if (outcome === "rejected") return "destructive";
  return "secondary";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

/** approved/rejected/corrected 비율 누적 막대. */
function OutcomeBar({ b }: { b: OutcomeBreakdown }) {
  const total = b.approved + b.rejected + b.corrected;
  if (total === 0) {
    return <div className="h-1.5 w-full rounded-full bg-muted" />;
  }
  const seg = (n: number, cls: string, key: string) =>
    n > 0 ? <div key={key} className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {seg(b.approved, OUTCOME_BG.approved, "a")}
      {seg(b.corrected, OUTCOME_BG.corrected, "c")}
      {seg(b.rejected, OUTCOME_BG.rejected, "r")}
    </div>
  );
}

export default function DomainPipelinePage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // 실시간 스트림 구독. 실패 시 1회 fetch 로 폴백.
    let cancelled = false;
    const es = new EventSource("/api/domain-pipeline/stream");
    esRef.current = es;

    es.addEventListener("snapshot", (e) => {
      if (cancelled) return;
      const snap = JSON.parse((e as MessageEvent).data) as Snapshot;
      setData(snap);
      setUpdatedAt(snap.generatedAt);
      setLoading(false);
      setError(null);
    });
    es.addEventListener("heartbeat", (e) => {
      if (cancelled) return;
      const { at } = JSON.parse((e as MessageEvent).data) as { at: string };
      setUpdatedAt(at);
    });
    es.addEventListener("error", () => {
      // 스트림 끊김 → 한 번 fetch 로 보강(EventSource 가 자동 재연결도 시도).
      setLive(false);
      fetch("/api/domain-pipeline")
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.error) setError(d.error);
          else {
            setData(d);
            setUpdatedAt(d.generatedAt ?? null);
          }
          setLoading(false);
        })
        .catch((err) => !cancelled && setError(String(err)));
    });
    es.onopen = () => !cancelled && setLive(true);

    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  const t = data?.totals;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">종축 도메인 파이프라인</h1>
          <p className="text-sm text-muted-foreground">
            마케팅 → 영업 → 프리세일즈 → 엔지니어 → CFO · 각 도메인 × 컬러 렌즈 · 도메인별 학습/결정
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40"}`}
            title={live ? "실시간 연결됨" : "오프라인"}
          />
          <span className="text-muted-foreground">
            {live ? "LIVE" : "정적"}
            {updatedAt && ` · ${relativeTime(updatedAt)} 갱신`}
          </span>
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">불러오는 중…</div>}
      {error && <div className="text-sm text-destructive">에러: {error}</div>}

      {data && t && (
        <>
          {/* 파이프라인 흐름 리본 */}
          <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-3">
            {data.rows.map((row, i) => (
              <div key={row.domain} className="flex items-center gap-1">
                <div className="flex flex-col items-center rounded-md bg-background px-3 py-1.5 shadow-sm">
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    M{row.memoryCount} · D{row.decisionCount}
                  </span>
                </div>
                {i < data.rows.length - 1 && <span className="px-0.5 text-muted-foreground">→</span>}
              </div>
            ))}
          </div>

          {/* 합계 스트립 */}
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">메모리 {t.memories}건</Badge>
            <Badge variant="secondary">결정로그 {t.decisions}건</Badge>
            <Badge variant="secondary" className={OUTCOME_TEXT.approved}>승인 {t.approved}</Badge>
            <Badge variant="secondary" className={OUTCOME_TEXT.corrected}>수정 {t.corrected}</Badge>
            <Badge variant="secondary" className={OUTCOME_TEXT.rejected}>반려 {t.rejected}</Badge>
          </div>

          {/* 도메인 카드 */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.rows.map((row, i) => (
              <Card key={row.domain} className="flex flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                      {row.label}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      → {row.handoffTo ?? "완료"}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-muted-foreground">렌즈</span>
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

                  {/* outcome 분해 막대 */}
                  <div className="space-y-1">
                    <OutcomeBar b={row.outcomeBreakdown} />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span className={OUTCOME_TEXT.approved}>승인 {row.outcomeBreakdown.approved}</span>
                      <span className={OUTCOME_TEXT.corrected}>수정 {row.outcomeBreakdown.corrected}</span>
                      <span className={OUTCOME_TEXT.rejected}>반려 {row.outcomeBreakdown.rejected}</span>
                    </div>
                  </div>

                  {/* 최근 결정 타임라인 */}
                  {row.recentDecisions.length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">최근 결정</div>
                      {row.recentDecisions.slice(0, 4).map((d, j) => (
                        <div key={j} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${OUTCOME_BG[d.outcome ?? ""] ?? "bg-muted-foreground/40"}`}
                            />
                            {d.outcome ?? "—"}
                          </span>
                          <span className="text-muted-foreground">{relativeTime(d.at)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto flex items-center justify-between border-t pt-2">
                    <span className="text-xs text-muted-foreground">
                      메모리 {row.memoryCount} · 결정 {row.decisionCount}
                    </span>
                    {row.lastOutcome && (
                      <Badge variant={outcomeVariant(row.lastOutcome)}>{row.lastOutcome}</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
