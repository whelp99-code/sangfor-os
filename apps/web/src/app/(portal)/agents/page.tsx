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
import { ColorKanbanBoard } from "@/components/color-agents/color-kanban-board";

type ColorStatus = "passed" | "pending" | "failed" | "not_required";

const COLORS: { name: string; label: string; desc: string; focus: string }[] = [
  { name: "Blue", label: "기술 검토", desc: "Technical Direction / Architecture", focus: "기술 방향, 구현, 아키텍처" },
  { name: "Red", label: "리스크 검토", desc: "Risk & Safety / Security", focus: "보안, 리스크, 회귀, 승인 우회" },
  { name: "Orange", label: "비즈니스 가치 검토", desc: "Product & Business Value", focus: "고객 가치, 매출, ROI" },
  { name: "Gray", label: "문서/근거 검토", desc: "Documentation & Evidence", focus: "문서, 결정 기록, 근거" },
  { name: "Teal", label: "UX/가시성 검토", desc: "UX & Visibility", focus: "UI/UX, 대시보드, 가시성" },
];

const AGENT_STATUSES: { name: string; status: ColorStatus; deal: string; reviewer: string }[] = [];

const HANDOFFS: { from: string; to: string; deal: string; time: string }[] = [];

const MY_REVIEWS: { role: string; deal: string; deadline: string; priority: string }[] = [];



function StatusIcon({ status }: { status: ColorStatus }) {
  switch (status) {
    case "passed": return <CheckCircle2 className="h-4 w-4 text-emerald-500" role="img" aria-label="Passed" />;
    case "pending": return <Clock className="h-4 w-4 text-amber-500" role="img" aria-label="Pending" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-500" role="img" aria-label="Failed" />;
    case "not_required": return <MinusCircle className="h-4 w-4 text-gray-400" role="img" aria-label="Not Required" />;
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
  if (priority === "critical") return <AlertTriangle className="h-3.5 w-3.5 text-red-500" role="img" aria-label="Critical priority" />;
  if (priority === "high") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" role="img" aria-label="High priority" />;
  return <Clock className="h-3.5 w-3.5 text-blue-500" role="img" aria-label="Medium priority" />;
}

export default function AgentsPage() {
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

      {/* Color Agent Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {COLORS.map((c) => {
          const agent = AGENT_STATUSES.find((a) => a.name === c.name);
          return (
            <Card key={c.name} className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <StatusIcon status={agent?.status ?? "not_required"} />
                  <CardTitle className="text-base">{c.name}</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">{c.desc}</p>
                <div className="flex items-center justify-between rounded-lg bg-muted/30 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <StatusBadge status={agent?.status ?? "not_required"} />
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/30 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">Deal</span>
                  <span className="text-xs font-medium truncate ml-2">{agent?.deal ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/30 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">Reviewer</span>
                  <span className="text-xs font-medium">{agent?.reviewer ?? "—"}</span>
                </div>
                <p className="text-xs text-muted-foreground pt-1">{c.focus}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* My Color Reviews + Handoff Activity */}
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
                    <Badge variant="outline" className="text-xs">{h.from}</Badge>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <Badge variant="outline" className="text-xs">{h.to}</Badge>
                    <span className="ml-1 truncate text-xs text-muted-foreground flex-1">{h.deal}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{h.time}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <ColorKanbanBoard />
    </div>
  );
}
