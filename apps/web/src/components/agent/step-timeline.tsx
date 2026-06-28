"use client";

import {
  CheckCircle2,
  ShieldAlert,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { AgentStep } from "@sangfor/agent";

import { cn } from "@/lib/utils";

const KIND_META: Record<AgentStep["kind"], { Icon: LucideIcon; accent: string; label: string }> = {
  tool: { Icon: Wrench, accent: "text-primary", label: "도구 호출" },
  final: { Icon: CheckCircle2, accent: "text-emerald-600 dark:text-emerald-400", label: "완료" },
  blocked: { Icon: ShieldAlert, accent: "text-amber-600 dark:text-amber-400", label: "승인 필요" },
  error: { Icon: XCircle, accent: "text-red-600 dark:text-red-400", label: "오류" },
};

function pretty(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function StepTimeline({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-2" aria-label="에이전트 실행 단계">
      {steps.map((step) => {
        const meta = KIND_META[step.kind];
        const { Icon } = meta;
        return (
          <li
            key={step.index}
            className="rounded-md border border-border bg-background p-3"
          >
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4 shrink-0", meta.accent)} aria-hidden="true" />
              <span className="text-xs font-semibold text-muted-foreground">
                #{step.index + 1} · {meta.label}
              </span>
              {step.tool && (
                <code className="font-mono text-xs font-semibold">{step.tool}</code>
              )}
              {typeof step.latencyMs === "number" && (
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {step.latencyMs}ms
                </span>
              )}
            </div>

            {step.thought && (
              <p className="mt-1.5 text-xs italic text-muted-foreground">“{step.thought}”</p>
            )}

            {step.arguments && Object.keys(step.arguments).length > 0 && (
              <pre className="mt-1.5 overflow-auto rounded-sm bg-muted/40 p-2 font-mono text-xs">
                {pretty(step.arguments)}
              </pre>
            )}

            {step.kind === "final" ? null : step.observation !== undefined && (
              <pre
                className={cn(
                  "mt-1.5 max-h-48 overflow-auto rounded-sm p-2 font-mono text-xs",
                  step.kind === "error"
                    ? "bg-red-500/10 text-red-700 dark:text-red-300"
                    : "bg-zinc-950 text-emerald-300",
                )}
              >
                {pretty(step.observation)}
              </pre>
            )}

            {step.error && step.kind !== "error" && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{step.error}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
