"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  FlaskConical,
  Truck,
  Headphones,
  ShieldCheck,
  Activity,
  DollarSign,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ColorReviewBadge } from "@/components/ui/color-review-badge";
import { krw } from "@/lib/cfo-theme";

type ColorReviewStatus = "passed" | "pending" | "failed" | "not_required";

type ColorReview = {
  name: string;
  status: ColorReviewStatus;
};

type PipelineRow = {
  family: string;
  forecast: number;
  weighted: number;
  deals: number;
};

type ApprovalItem = {
  id: string;
  customer: string;
  type: string;
  waitDays: number;
  risk: string;
};

type PocItem = {
  product: string;
  success: number;
  fail: number;
  rate: string;
};

type DeliveryWarning = {
  customer: string;
  product: string;
  delayDays: number;
  reason: string;
};

type SupportHotspot = {
  customer: string;
  tickets: number;
  slaBreach: number;
  severity: string;
};

type HealthService = {
  name: string;
  status: string;
  latency: string;
};

type ExecutiveData = {
  revenuePipeline: { total: number; weighted: number; deals: number };
  productForecast: PipelineRow[];
  grossMarginRisk: { blendedMargin: number; belowThresholdDeals: number; avgDiscount: number };
  approvalBottleneck: ApprovalItem[];
  pocSuccessRate: PocItem[];
  deliveryDelay: DeliveryWarning[];
  supportHotspots: SupportHotspot[];
  colorReviews: ColorReview[];
  systemHealth: HealthService[];
  renewalForecast: number;
  securityAlerts: number;
};

const COLORS_DATA: { name: string; agent: string; label: string; desc: string }[] = [
  { name: "Blue", agent: "blue", label: "기술 검토", desc: "Technical Direction / Architecture" },
  { name: "Red", agent: "red", label: "리스크 검토", desc: "Risk & Safety / Security" },
  { name: "Orange", agent: "orange", label: "비즈니스 가치 검토", desc: "Product & Business Value" },
  { name: "Gray", agent: "gray", label: "문서/근거 검토", desc: "Documentation & Evidence" },
  { name: "Teal", agent: "teal", label: "UX/가시성 검토", desc: "UX & Visibility" },
];

function ColorBadge({ status, agent = "blue" }: { status: ColorReviewStatus; agent?: string }) {
  return <ColorReviewBadge agent={agent} status={status} size="sm" />;
}

function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, { label: string; variant: "destructive" | "secondary" | "outline" }> = {
    high: { label: "높음", variant: "destructive" },
    medium: { label: "중간", variant: "secondary" },
    low: { label: "낮음", variant: "outline" },
  };
  const { label, variant } = map[risk] ?? { label: risk, variant: "outline" as const };
  return <Badge variant={variant}>{label}</Badge>;
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <AlertCircle className="h-4 w-4 text-red-500" role="img" aria-label="심각 등급" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" role="img" aria-label="주의 등급" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-500" role="img" aria-label="정상 등급" />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="h-48 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-12 text-center dark:border-red-900/50 dark:bg-red-950/20">
      <XCircle className="h-10 w-10 text-red-500" />
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">대시보드를 불러오지 못했습니다</h2>
      <p className="text-sm text-red-600 dark:text-red-300">{message}</p>
    </div>
  );
}

export function ExecutiveDashboard() {
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/dashboard/executive");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (error) return <ErrorState message={error} />;

  if (!data) return <ErrorState message="반환된 데이터가 없습니다" />;

  const totalForecast = data.productForecast.reduce((s, r) => s + r.forecast, 0);
  const totalWeighted = data.productForecast.reduce((s, r) => s + r.weighted, 0);

  // Distinguish "no data collected yet" from genuine zero values: when every
  // data source is empty and the pipeline totals are zero, the 0s and empty
  // tables below reflect an unpopulated dataset, not real measured zeros.
  const noDataCollected =
    data.revenuePipeline.total === 0 &&
    data.revenuePipeline.deals === 0 &&
    data.productForecast.length === 0 &&
    data.approvalBottleneck.length === 0 &&
    data.pocSuccessRate.length === 0 &&
    data.deliveryDelay.length === 0 &&
    data.supportHotspots.length === 0 &&
    data.systemHealth.length === 0;

  return (
    <div className="space-y-6">
      {noDataCollected && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300">
          아직 집계된 데이터가 없습니다. 아래 0과 빈 표는 실제 측정값이 아니라 수집된 데이터가 없음을 의미합니다.
        </div>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
            <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-base">매출 파이프라인 — 제품군별 예측</CardTitle>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">합계: </span>
            <span className="font-semibold">{krw(totalForecast)}</span>
            <span className="text-muted-foreground">가중치 적용: </span>
            <span className="font-semibold">{krw(totalWeighted)}</span>
          </div>
        </CardHeader>
        <CardContent>
          {data.productForecast.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">파이프라인 데이터가 없습니다</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>제품군</TableHead>
                  <TableHead className="text-right">예측(₩)</TableHead>
                  <TableHead className="text-right">가중치 적용(₩)</TableHead>
                  <TableHead className="text-right">거래 수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.productForecast.map((row) => (
                  <TableRow key={row.family}>
                    <TableCell className="font-medium">{row.family}</TableCell>
                    <TableCell className="text-right">{krw(row.forecast)}</TableCell>
                    <TableCell className="text-right">{krw(row.weighted)}</TableCell>
                    <TableCell className="text-right">{row.deals}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/50">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-base">매출총이익 리스크</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
              <span className="text-muted-foreground">종합 매출총이익률</span>
              <span className="font-semibold text-amber-600">{data.grossMarginRisk.blendedMargin}%</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
              <span className="text-muted-foreground">기준 미달 거래</span>
              <Badge variant="destructive">{data.grossMarginRisk.belowThresholdDeals}건</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
              <span className="text-muted-foreground">평균 할인율</span>
              <span className="font-semibold">{data.grossMarginRisk.avgDiscount}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-base">승인 병목</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.approvalBottleneck.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">승인 병목이 없습니다</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>고객</TableHead>
                    <TableHead>유형</TableHead>
                    <TableHead className="text-right">대기</TableHead>
                    <TableHead>리스크</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.approvalBottleneck.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.customer}</TableCell>
                      <TableCell>{a.type}</TableCell>
                      <TableCell className="text-right">{a.waitDays}일</TableCell>
                      <TableCell><RiskBadge risk={a.risk} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
              <FlaskConical className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <CardTitle className="text-base">PoC 성공률</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.pocSuccessRate.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">PoC 데이터가 없습니다</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>제품</TableHead>
                    <TableHead className="text-right">성공</TableHead>
                    <TableHead className="text-right">실패</TableHead>
                    <TableHead className="text-right">성공률</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pocSuccessRate.map((row) => (
                    <TableRow key={row.product}>
                      <TableCell className="font-medium">{row.product}</TableCell>
                      <TableCell className="text-right text-emerald-600">{row.success}</TableCell>
                      <TableCell className="text-right text-red-600">{row.fail}</TableCell>
                      <TableCell className="text-right font-semibold">{row.rate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/50">
              <Truck className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
            <CardTitle className="text-base">납품 지연 경고</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.deliveryDelay.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">납품 지연이 없습니다</p>
            ) : (
              data.deliveryDelay.map((w) => (
                <div key={w.customer} className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                  <div>
                    <p className="font-medium">{w.customer}</p>
                    <p className="text-xs text-muted-foreground">{w.product} — {w.reason}</p>
                  </div>
                  <Badge variant="destructive">{w.delayDays}일 지연</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/50">
              <Headphones className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            </div>
            <CardTitle className="text-base">지원 이슈 집중 고객</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.supportHotspots.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">지원 이슈 집중 고객이 없습니다</p>
            ) : (
              data.supportHotspots.map((s) => (
                <div key={s.customer} className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <SeverityIcon severity={s.severity} />
                    <div>
                      <p className="font-medium">{s.customer}</p>
                      <p className="text-xs text-muted-foreground">티켓 {s.tickets}건, SLA 위반 {s.slaBreach}건</p>
                    </div>
                  </div>
                  <Badge variant={s.severity === "critical" ? "destructive" : s.severity === "warning" ? "secondary" : "outline"}>
                    {s.severity === "critical" ? "심각" : s.severity === "warning" ? "주의" : "정상"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/50">
              <ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <CardTitle className="text-base">컬러 에이전트 검토 현황</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-2">
              {data.colorReviews.length === 0 ? (
                <p className="col-span-5 py-4 text-center text-sm text-muted-foreground">컬러 검토가 없습니다</p>
              ) : (
                  data.colorReviews.map((c) => {
                    const colorDef = COLORS_DATA.find((x) => x.name === c.name)!;
                    return (
                      <div key={c.name} className="flex flex-col items-center gap-1.5 rounded-lg border bg-background/60 p-3 text-center">
                        <span className="text-xs font-semibold">{colorDef?.label ?? c.name}</span>
                        <span className="text-[10px] text-muted-foreground">{colorDef?.desc ?? ""}</span>
                        <ColorBadge status={c.status as ColorReviewStatus} agent={colorDef?.agent ?? "blue"} />
                      </div>
                    );
                  })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
            <Activity className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          </div>
          <CardTitle className="text-base">시스템 상태 개요</CardTitle>
        </CardHeader>
        <CardContent>
          {data.systemHealth.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">상태 데이터가 없습니다</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.systemHealth.map((svc) => (
                <div key={svc.name} className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {svc.status === "ok" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" role="img" aria-label={`${svc.name} 정상`} />
                    ) : svc.status === "degraded" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" role="img" aria-label={`${svc.name} 성능 저하`} />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500" role="img" aria-label={`${svc.name} 오류`} />
                    )}
                    <div>
                      <p className="text-sm font-medium">{svc.name}</p>
                      <p className="text-xs text-muted-foreground">{svc.latency}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-right text-xs text-muted-foreground">
        <span>Package V3.2 — Hermes Color Agent</span>
      </div>
    </div>
  );
}
