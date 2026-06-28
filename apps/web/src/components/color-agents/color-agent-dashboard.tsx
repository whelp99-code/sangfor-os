"use client";

import {
  ArrowRight,
  Activity,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ColorReviewBadge, ColorAgentDot } from "@/components/ui/color-review-badge";

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

const KANBAN_COLUMNS: { name: string; deals: string[] }[] = [
  { name: "To Blue", deals: [] },
  { name: "To Red", deals: [] },
  { name: "To Orange", deals: [] },
  { name: "To Gray", deals: [] },
  { name: "To Teal", deals: [] },
  { name: "Resolved", deals: [] },
  { name: "Escalated", deals: [] },
];

function StatusBadge({ status, agent = "blue" }: { status: ColorStatus; agent?: string }) {
  return <ColorReviewBadge agent={agent} status={status} size="sm" />;
}

export function ColorAgentDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {COLORS.map((c) => {
          const agent = AGENT_STATUSES.find((a) => a.name === c.name);
          const agentKey = c.name.toLowerCase();
          return (
            <Card key={c.name} className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ColorAgentDot agent={agentKey} />
                  <CardTitle className="text-base">{c.label}</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.name} — {c.desc}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-lg bg-muted/30 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">Status</span>
                  <StatusBadge status={agent?.status ?? "not_required"} agent={agentKey} />
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
              <Activity className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-base">My Color Reviews</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
              {MY_REVIEWS.map((r) => {
                const agentKey = r.role.split(" — ")[0].toLowerCase();
                return (
                  <div key={r.role} className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <ColorAgentDot agent={agentKey} />
                      <div>
                        <p className="text-sm font-medium">{r.role}</p>
                        <p className="text-xs text-muted-foreground">{r.deal}</p>
                      </div>
                    </div>
                    <Badge variant={r.priority === "critical" ? "destructive" : "secondary"}>
                      {r.deadline}
                    </Badge>
                  </div>
                );
              })}
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

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
            <Activity className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
          <CardTitle className="text-base">Project Board — Color Review Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7">
            {KANBAN_COLUMNS.map((col) => {
              const agentKey = col.name.replace("To ", "").toLowerCase();
              const isTerminal = col.name === "Resolved" || col.name === "Escalated";
              return (
                <div key={col.name} className={`rounded-lg border p-2 min-h-[140px] transition-shadow hover:shadow-sm ${isTerminal ? "bg-muted/10" : ""}`}>
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    {!isTerminal && <ColorAgentDot agent={agentKey} />}
                    <h3 className={`text-xs font-semibold ${isTerminal ? "text-muted-foreground" : ""}`}>{col.name}</h3>
                  </div>
                  <div className="space-y-1.5">
                    {col.deals.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6 italic">—</p>
                    ) : (
                      col.deals.map((d) => (
                        <div key={d} className="rounded-md border bg-background px-2 py-2 text-xs leading-tight shadow-sm hover:shadow transition-shadow">
                          {d}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
