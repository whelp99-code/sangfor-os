"use client";

import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  MinusCircle,
  ArrowRight,
  Activity,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

type ColorStatus = "passed" | "pending" | "failed" | "not_required";

const COLORS: { name: string; label: string; desc: string; focus: string }[] = [
  { name: "Blue", label: "기술 검토", desc: "Technical Direction / Architecture", focus: "기술 방향, 구현, 아키텍처" },
  { name: "Red", label: "리스크 검토", desc: "Risk & Safety / Security", focus: "보안, 리스크, 회귀, 승인 우회" },
  { name: "Orange", label: "비즈니스 가치 검토", desc: "Product & Business Value", focus: "고객 가치, 매출, ROI" },
  { name: "Gray", label: "문서/근거 검토", desc: "Documentation & Evidence", focus: "문서, 결정 기록, 근거" },
  { name: "Teal", label: "UX/가시성 검토", desc: "UX & Visibility", focus: "UI/UX, 대시보드, 가시성" },
];

const AGENT_STATUSES = [
  { name: "Blue", status: "passed" as ColorStatus, deal: "OPP-2024-0842 — 신한은행", reviewer: "김기술" },
  { name: "Red", status: "pending" as ColorStatus, deal: "OPP-2024-0791 — 현대모비스", reviewer: "박리스크" },
  { name: "Orange", status: "failed" as ColorStatus, deal: "OPP-2024-0765 — LG CNS", reviewer: "최비즈" },
  { name: "Gray", status: "passed" as ColorStatus, deal: "OPP-2024-0723 — SK Telecom", reviewer: "정문서" },
  { name: "Teal", status: "not_required" as ColorStatus, deal: "OPP-2024-0842 — 신한은행", reviewer: "—" },
];

const HANDOFFS = [
  { from: "Blue", to: "Red", deal: "OPP-2024-0842 — 신한은행", time: "10 min ago" },
  { from: "Red", to: "Orange", deal: "OPP-2024-0791 — 현대모비스", time: "1 hr ago" },
  { from: "Orange", to: "Gray", deal: "OPP-2024-0765 — LG CNS", time: "3 hr ago" },
  { from: "Gray", to: "Teal", deal: "OPP-2024-0765 — LG CNS", time: "5 hr ago" },
  { from: "Blue", to: "Red", deal: "OPP-2024-0723 — SK Telecom", time: "1 day ago" },
];

const MY_REVIEWS = [
  { role: "Blue — 기술 검토", deal: "OPP-2024-0842 — 신한은행", deadline: "Today", priority: "critical" },
  { role: "Red — 리스크 검토", deal: "OPP-2024-0791 — 현대모비스", deadline: "Tomorrow", priority: "high" },
  { role: "Orange — 비즈니스 가치 검토", deal: "OPP-2024-0765 — LG CNS", deadline: "Jul 30", priority: "medium" },
  { role: "Gray — 문서/근거 검토", deal: "OPP-2024-0723 — SK Telecom", deadline: "Jul 28", priority: "high" },
];

const KANBAN_COLUMNS = [
  { name: "To Blue", deals: ["OPP-2024-0912 — 삼성SDS", "OPP-2024-0901 — CJ올리브네트웍스"] },
  { name: "To Red", deals: ["OPP-2024-0842 — 신한은행", "OPP-2024-0791 — 현대모비스"] },
  { name: "To Orange", deals: ["OPP-2024-0765 — LG CNS"] },
  { name: "To Gray", deals: [] as string[] },
  { name: "To Teal", deals: [] as string[] },
  { name: "Resolved", deals: ["OPP-2024-0689 — KT", "OPP-2024-0654 — 네이버"] },
  { name: "Escalated", deals: ["OPP-2024-0723 — SK Telecom"] },
];

function StatusIcon({ status }: { status: ColorStatus }) {
  switch (status) {
    case "passed": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "pending": return <Clock className="h-4 w-4 text-amber-500" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
    case "not_required": return <MinusCircle className="h-4 w-4 text-gray-400" />;
  }
}

function StatusBadge({ status }: { status: ColorStatus }) {
  const map: Record<ColorStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    passed: { label: "Passed", variant: "default" },
    pending: { label: "Pending", variant: "secondary" },
    failed: { label: "Failed", variant: "destructive" },
    not_required: { label: "N/A", variant: "outline" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function PriorityIcon({ priority }: { priority: string }) {
  if (priority === "critical") return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
  if (priority === "high") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  return <Clock className="h-3.5 w-3.5 text-blue-500" />;
}

export function ColorAgentDashboard() {
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-blue-500/10 blur-2xl" />
        <div className="relative">
          <p className="text-sm font-medium text-gray-400">Sangfor Agentic OS</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Color Agents</h1>
          <p className="mt-2 text-sm text-gray-400">
            Review perspectives and Kanban handoff owners — they do not replace business personas
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {COLORS.map((c) => {
          const agent = AGENT_STATUSES.find((a) => a.name === c.name)!;
          return (
            <Card key={c.name} className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <StatusIcon status={agent.status} />
                  <CardTitle className="text-base">{c.name}</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">{c.desc}</p>
                <div className="flex items-center justify-between rounded-lg bg-muted/30 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <StatusBadge status={agent.status} />
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/30 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">Deal</span>
                  <span className="text-xs font-medium truncate ml-2">{agent.deal}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/30 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">Reviewer</span>
                  <span className="text-xs font-medium">{agent.reviewer}</span>
                </div>
                <p className="text-[10px] text-muted-foreground pt-1">{c.focus}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
              <Activity className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-base">My Color Reviews</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {MY_REVIEWS.map((r) => (
              <div key={r.role} className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <PriorityIcon priority={r.priority} />
                  <div>
                    <p className="text-sm font-medium">{r.role}</p>
                    <p className="text-xs text-muted-foreground">{r.deal}</p>
                  </div>
                </div>
                <Badge variant={r.priority === "critical" ? "destructive" : "secondary"}>
                  {r.deadline}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <ArrowRight className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <CardTitle className="text-base">Handoff Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[260px]">
              <div className="space-y-1 px-4">
                {HANDOFFS.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm">
                    <Badge variant="outline" className="text-[10px]">{h.from}</Badge>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <Badge variant="outline" className="text-[10px]">{h.to}</Badge>
                    <span className="ml-1 truncate text-xs text-muted-foreground flex-1">{h.deal}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{h.time}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
            <Activity className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
          <CardTitle className="text-base">Project Board — Color Review Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7">
            {KANBAN_COLUMNS.map((col) => (
              <div key={col.name} className="rounded-lg border bg-muted/20 p-2 min-h-[120px]">
                <h3 className="text-xs font-semibold mb-2 text-center">{col.name}</h3>
                <div className="space-y-1.5">
                  {col.deals.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground text-center py-4">—</p>
                  ) : (
                    col.deals.map((d) => (
                      <div key={d} className="rounded border bg-background px-2 py-1.5 text-[10px] leading-tight">
                        {d}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
