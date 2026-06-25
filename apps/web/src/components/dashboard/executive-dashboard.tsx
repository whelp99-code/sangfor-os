"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp,
  AlertTriangle,
  Clock,
  FlaskConical,
  Truck,
  Headphones,
  ShieldCheck,
  Activity,
  DollarSign,
  BarChart3,
  Users,
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
import { STATUS_LABELS } from "@sangfor/shared";

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

const COLORS_DATA: { name: string; label: string; desc: string }[] = [
  { name: "Blue", label: "기술 검토", desc: "Technical Direction / Architecture" },
  { name: "Red", label: "리스크 검토", desc: "Risk & Safety / Security" },
  { name: "Orange", label: "비즈니스 가치 검토", desc: "Product & Business Value" },
  { name: "Gray", label: "문서/근거 검토", desc: "Documentation & Evidence" },
  { name: "Teal", label: "UX/가시성 검토", desc: "UX & Visibility" },
];

function ColorBadge({ status }: { status: ColorReviewStatus }) {
  const map: Record<ColorReviewStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    passed: { label: "Passed", variant: "default" },
    pending: { label: "Pending", variant: "secondary" },
    failed: { label: "Failed", variant: "destructive" },
    not_required: { label: "N/A", variant: "outline" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, { label: string; variant: "destructive" | "secondary" | "outline" }> = {
    high: { label: "High", variant: "destructive" },
    medium: { label: "Medium", variant: "secondary" },
    low: { label: "Low", variant: "outline" },
  };
  const { label, variant } = map[risk] ?? { label: risk, variant: "outline" as const };
  return <Badge variant={variant}>{label}</Badge>;
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <AlertCircle className="h-4 w-4 text-red-500" role="img" aria-label="Critical severity" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" role="img" aria-label="Warning severity" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-500" role="img" aria-label="OK severity" />;
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
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">Failed to load dashboard</h2>
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
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (error) return <ErrorState message={error} />;

  if (!data) return <ErrorState message="No data returned" />;

  const totalForecast = data.productForecast.reduce((s, r) => s + r.forecast, 0);
  const totalWeighted = data.productForecast.reduce((s, r) => s + r.weighted, 0);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-blue-500/10 blur-2xl" />
        <div className="relative">
          <p className="text-sm font-medium text-gray-400">Sangfor Agentic OS</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Executive Dashboard
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            Unified visibility across revenue, delivery, support, and governance
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
            <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-base">Revenue Pipeline — Product-family Forecast</CardTitle>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Total: </span>
            <span className="font-semibold">${totalForecast.toLocaleString()}</span>
            <span className="text-muted-foreground">Weighted: </span>
            <span className="font-semibold">${totalWeighted.toLocaleString()}</span>
          </div>
        </CardHeader>
        <CardContent>
          {data.productForecast.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No pipeline data available</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Family</TableHead>
                  <TableHead className="text-right">Forecast ($)</TableHead>
                  <TableHead className="text-right">Weighted ($)</TableHead>
                  <TableHead className="text-right">Deals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.productForecast.map((row) => (
                  <TableRow key={row.family}>
                    <TableCell className="font-medium">{row.family}</TableCell>
                    <TableCell className="text-right">{row.forecast.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{row.weighted.toLocaleString()}</TableCell>
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
            <CardTitle className="text-base">Gross Margin Risk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
              <span className="text-muted-foreground">Blended Gross Margin</span>
              <span className="font-semibold text-amber-600">{data.grossMarginRisk.blendedMargin}%</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
              <span className="text-muted-foreground">Below threshold deals</span>
              <Badge variant="destructive">{data.grossMarginRisk.belowThresholdDeals} deals</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
              <span className="text-muted-foreground">Avg discount rate</span>
              <span className="font-semibold">{data.grossMarginRisk.avgDiscount}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-base">Approval Bottleneck</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.approvalBottleneck.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No approval bottlenecks</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Wait</TableHead>
                    <TableHead>Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.approvalBottleneck.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.customer}</TableCell>
                      <TableCell>{a.type}</TableCell>
                      <TableCell className="text-right">{a.waitDays}d</TableCell>
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
            <CardTitle className="text-base">PoC Success Rate</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.pocSuccessRate.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No PoC data available</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Success</TableHead>
                    <TableHead className="text-right">Fail</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
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
            <CardTitle className="text-base">Delivery Delay Warnings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.deliveryDelay.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No delivery delays</p>
            ) : (
              data.deliveryDelay.map((w) => (
                <div key={w.customer} className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                  <div>
                    <p className="font-medium">{w.customer}</p>
                    <p className="text-xs text-muted-foreground">{w.product} — {w.reason}</p>
                  </div>
                  <Badge variant="destructive">{w.delayDays}d delay</Badge>
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
            <CardTitle className="text-base">Support Hotspots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.supportHotspots.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No support hotspots</p>
            ) : (
              data.supportHotspots.map((s) => (
                <div key={s.customer} className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <SeverityIcon severity={s.severity} />
                    <div>
                      <p className="font-medium">{s.customer}</p>
                      <p className="text-xs text-muted-foreground">{s.tickets} tickets, {s.slaBreach} SLA breaches</p>
                    </div>
                  </div>
                  <Badge variant={s.severity === "critical" ? "destructive" : s.severity === "warning" ? "secondary" : "outline"}>
                    {s.severity}
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
            <CardTitle className="text-base">Color Agent Review Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-2">
              {data.colorReviews.length === 0 ? (
                <p className="col-span-5 py-4 text-center text-sm text-muted-foreground">No color reviews</p>
              ) : (
                data.colorReviews.map((c) => {
                  const colorDef = COLORS_DATA.find((x) => x.name === c.name)!;
                  return (
                    <div key={c.name} className="flex flex-col items-center gap-1 rounded-lg border p-2 text-center">
                      <span className="text-xs font-semibold">{c.name}</span>
                      <span className="text-[10px] text-muted-foreground">{colorDef?.label ?? ""}</span>
                      <ColorBadge status={c.status as ColorReviewStatus} />
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
          <CardTitle className="text-base">System Health Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {data.systemHealth.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No health data available</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.systemHealth.map((svc) => (
                <div key={svc.name} className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {svc.status === "ok" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" role="img" aria-label={`${svc.name} status OK`} />
                    ) : svc.status === "degraded" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" role="img" aria-label={`${svc.name} status degraded`} />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500" role="img" aria-label={`${svc.name} status error`} />
                    )}
                    <div>
                      <p className="text-sm font-medium">{svc.name}</p>
                      <p className="text-[10px] text-muted-foreground">{svc.latency}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-right text-xs text-muted-foreground">
        <span>{STATUS_LABELS.ready_for_human_approval}</span>
      </div>
    </div>
  );
}
