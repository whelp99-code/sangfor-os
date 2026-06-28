"use client";

import { useState } from "react";
import { Bot, BookMarked, CalendarClock, Workflow, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { PlaybooksPanel } from "./playbooks-panel";
import { RunPanel } from "./run-panel";
import { SchedulesPanel } from "./schedules-panel";
import { WorkflowPanel } from "./workflow-panel";

type View = "run" | "workflow" | "playbooks" | "schedules";

const TABS: { id: View; label: string; Icon: LucideIcon }[] = [
  { id: "run", label: "실행", Icon: Bot },
  { id: "workflow", label: "워크플로우", Icon: Workflow },
  { id: "playbooks", label: "플레이북", Icon: BookMarked },
  { id: "schedules", label: "스케줄", Icon: CalendarClock },
];

export function AgentConsole() {
  const [view, setView] = useState<View>("run");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent Console</h1>
        <p className="text-muted-foreground">
          MCP 도구를 연쇄 호출하는 자율 에이전트 — 실행 · 플레이북 · 스케줄
        </p>
      </div>

      <div
        role="tablist"
        aria-label="에이전트 콘솔 보기"
        className="inline-flex rounded-lg border border-border bg-muted p-0.5"
      >
        {TABS.map((tab) => {
          const active = view === tab.id;
          const { Icon } = tab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => setView(tab.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {view === "run" && <RunPanel />}
      {view === "workflow" && <WorkflowPanel />}
      {view === "playbooks" && <PlaybooksPanel />}
      {view === "schedules" && <SchedulesPanel />}
    </div>
  );
}
