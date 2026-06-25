"use client";

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

type ColorReview = {
  name: string;
  status: "passed" | "pending" | "failed" | "not_required";
};

const COLORS: { name: string; label: string; desc: string }[] = [
  { name: "Blue", label: "기술 검토", desc: "Technical Direction / Architecture" },
  { name: "Red", label: "리스크 검토", desc: "Risk & Safety / Security" },
  { name: "Orange", label: "비즈니스 가치 검토", desc: "Product & Business Value" },
  { name: "Gray", label: "문서/근거 검토", desc: "Documentation & Evidence" },
  { name: "Teal", label: "UX/가시성 검토", desc: "UX & Visibility" },
];

const COLOR_REVIEWS: ColorReview[] = [
  { name: "Blue", status: "passed" },
  { name: "Red", status: "pending" },
  { name: "Orange", status: "failed" },
  { name: "Gray", status: "passed" },
  { name: "Teal", status: "not_required" },
];

const PIPELINE_ROWS = [
  { family: "Sangfor NGAF", forecast: 2840000, weighted: 1988000, deals: 4 },
  { family: "Sangfor aDesk", forecast: 1520000, weighted: 1064000, deals: 3 },
  { family: "Sangfor HCI", forecast: 920000, weighted: 644000, deals: 2 },
  { family: "Sangfor IAM", forecast: 510000, weighted: 357000, deals: 2 },
  { family: "Sangfor SD-WAN", forecast: 380000, weighted: 266000, deals: 1 },
];

const APPROVALS = [
  { id: "OPP-2024-0842", customer: "신한은행", type: "Special Discount", waitDays: 4, risk: "high" },
  { id: "OPP-2024-0791", customer: "현대모비스", type: "Payment Terms", waitDays: 7, risk: "medium" },
  { id: "OPP-2024-0765", customer: "LG CNS", type: "Margin Override", waitDays: 2, risk: "low" },
  { id: "OPP-2024-0723", customer: "SK Telecom", type: "Contract Value", waitDays: 11, risk: "high" },
];

const POC_HEATMAP = [
  { product: "NGAF", success: 8, fail: 1, rate: "89%" },
  { product: "aDesk", success: 6, fail: 2, rate: "75%" },
  { product: "HCI", success: 4, fail: 0, rate: "100%" },
  { product: "IAM", success: 3, fail: 1, rate: "75%" },
  { product: "SD-WAN", success: 2, fail: 0, rate: "100%" },
];

const DELIVERY_WARNINGS = [
  { customer: "기아자동차", product: "NGAF-4000", delayDays: 14, reason: "License import delay" },
  { customer: "KB국민은행", product: "aDesk-V", delayDays: 7, reason: "Site prep incomplete" },
  { customer: "삼성전자", product: "HCI-2000", delayDays: 3, reason: "SOW not signed" },
];

const SUPPORT_HOTSPOTS = [
  { customer: "롯데정보통신", tickets: 12, slaBreach: 3, severity: "critical" },
  { customer: "KT Cloud", tickets: 8, slaBreach: 1, severity: "warning" },
  { customer: "네이버클라우드", tickets: 5, slaBreach: 0, severity: "ok" },
];

function ColorBadge({ status }: { status: ColorReview["status"] }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
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
  const { label, variant } = map[risk];
  return <Badge variant={variant}>{label}</Badge>;
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <AlertCircle className="h-4 w-4 text-red-500" role="img" aria-label="Critical severity" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" role="img" aria-label="Warning severity" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-500" role="img" aria-label="OK severity" />;
}

export function ExecutiveDashboard() {
  const totalForecast = PIPELINE_ROWS.reduce((s, r) => s + r.forecast, 0);
  const totalWeighted = PIPELINE_ROWS.reduce((s, r) => s + r.weighted, 0);

  return (
    <div className="space-y-6">
      {/* Branding Header */}
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

      {/* Revenue Pipeline */}
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
          {PIPELINE_ROWS.length === 0 ? (
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
              {PIPELINE_ROWS.map((row) => (
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

      {/* Gross Margin Risk + Approval Bottleneck */}
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
              <span className="font-semibold text-amber-600">34.2%</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
              <span className="text-muted-foreground">Below threshold deals</span>
              <Badge variant="destructive">4 deals</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
              <span className="text-muted-foreground">Avg discount rate</span>
              <span className="font-semibold">28.5%</span>
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
            {APPROVALS.length === 0 ? (
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
                {APPROVALS.map((a) => (
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

      {/* PoC Success Rate Heatmap + Delivery Delay */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
              <FlaskConical className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <CardTitle className="text-base">PoC Success Rate</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {POC_HEATMAP.length === 0 ? (
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
                {POC_HEATMAP.map((row) => (
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
            {DELIVERY_WARNINGS.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No delivery delays</p>
            ) : (
              DELIVERY_WARNINGS.map((w) => (
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

      {/* Support Hotspots + Color Agent Summary */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/50">
              <Headphones className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            </div>
            <CardTitle className="text-base">Support Hotspots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {SUPPORT_HOTSPOTS.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No support hotspots</p>
            ) : (
              SUPPORT_HOTSPOTS.map((s) => (
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
              {COLOR_REVIEWS.map((c) => {
                const colorDef = COLORS.find((x) => x.name === c.name)!;
                return (
                  <div key={c.name} className="flex flex-col items-center gap-1 rounded-lg border p-2 text-center">
                    <span className="text-xs font-semibold">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground">{colorDef.label}</span>
                    <ColorBadge status={c.status} />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System Health Overview */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
            <Activity className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          </div>
          <CardTitle className="text-base">System Health Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { name: "AI Orchestrator", status: "ok", latency: "12ms" },
              { name: "Mail Intelligence", status: "ok", latency: "45ms" },
              { name: "Knowledge Base", status: "ok", latency: "23ms" },
              { name: "Tool Gateway", status: "degraded", latency: "890ms" },
              { name: "Approval Engine", status: "ok", latency: "8ms" },
              { name: "Agent Runtime", status: "ok", latency: "34ms" },
              { name: "Document API", status: "error", latency: "—" },
              { name: "Audit Chain", status: "ok", latency: "56ms" },
            ].map((svc) => (
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
        </CardContent>
      </Card>
    </div>
  );
}
