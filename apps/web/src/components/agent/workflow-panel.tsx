"use client";

import {
  CheckCircle2,
  CircleDashed,
  Play,
  RefreshCw,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { StageResult, StageStatus } from "@sangfor/agent";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useWorkflowRun } from "@/lib/agent/use-workflow-run";
import { useState } from "react";

const STAGE_META: Record<StageStatus, { Icon: LucideIcon; accent: string; label: string }> = {
  completed: { Icon: CheckCircle2, accent: "text-emerald-600 dark:text-emerald-400", label: "완료" },
  blocked: { Icon: ShieldAlert, accent: "text-amber-600 dark:text-amber-400", label: "승인 필요" },
  error: { Icon: XCircle, accent: "text-red-600 dark:text-red-400", label: "오류" },
  skipped: { Icon: CircleDashed, accent: "text-muted-foreground", label: "건너뜀" },
};

const SAMPLE = "지점 사무실에 NGAF 방화벽과 SD-WAN을 도입하려 합니다. 보안 정책과 회선 이중화를 포함한 구성안을 만들어 주세요.";

function riskBadge(output: unknown) {
  const risk = (output as { risk?: string } | null)?.risk;
  if (!risk) return null;
  const cls =
    risk === "high"
      ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
      : risk === "medium"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  return (
    <Badge variant="outline" className={cn("border text-[10px]", cls)}>
      risk: {risk}
    </Badge>
  );
}

function StageRow({ stage }: { stage: StageResult }) {
  const meta = STAGE_META[stage.status];
  const { Icon } = meta;
  return (
    <li className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", meta.accent)} aria-hidden="true" />
        <span className="text-sm font-semibold">{stage.title}</span>
        <Badge variant="outline" className="text-[10px] uppercase">
          {stage.kind}
        </Badge>
        {stage.id === "verify" && riskBadge(stage.output)}
        <span className="ml-auto text-xs text-muted-foreground">{meta.label}</span>
        {typeof stage.latencyMs === "number" && (
          <span className="font-mono text-xs text-muted-foreground">{stage.latencyMs}ms</span>
        )}
      </div>
      {stage.error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{stage.error}</p>}
      {stage.output !== undefined && stage.kind !== "approval" && (
        <pre className="mt-1.5 max-h-40 overflow-auto rounded-sm bg-muted/40 p-2 font-mono text-xs">
          {JSON.stringify(stage.output, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function WorkflowPanel() {
  const { phase, stages, awaitingApproval, error, requirements, run } = useWorkflowRun();
  const [input, setInput] = useState("");

  const running = phase === "running";
  const goal = input.trim() || requirements;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">구성 자동화 워크플로우</CardTitle>
          <CardDescription>
            분석 → 구성안 생성 → LLM 검증 → 승인 → 적용. 서비스 횡단 파이프라인이며 적용 전 사람이
            승인해야 합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder={SAMPLE}
            aria-label="요구사항"
            className="w-full rounded-md border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center gap-2">
            <Button onClick={() => run({ requirements: input.trim() || SAMPLE })} disabled={running} size="sm">
              {running ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              워크플로우 실행
            </Button>
            <span className="text-xs text-muted-foreground">비워두면 샘플 요구사항으로 실행됩니다.</span>
          </div>
        </CardContent>
      </Card>

      {phase === "error" && error && (
        <div role="alert" className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
          <p className="font-bold">워크플로우 실패</p>
          <p className="mt-0.5">{error}</p>
          <p className="mt-1 text-[11px] opacity-80">engineer-console(:3502)와 LLM 설정을 확인하세요.</p>
        </div>
      )}

      <div aria-live="polite">
        {stages.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">파이프라인 ({stages.length}단계)</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2" aria-label="워크플로우 단계">
                {stages.map((s) => (
                  <StageRow key={s.id} stage={s} />
                ))}
              </ol>
            </CardContent>
          </Card>
        )}
      </div>

      {phase === "blocked" && awaitingApproval && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            적용 승인 대기
          </div>
          <p className="text-xs leading-relaxed">
            검증을 마쳤습니다. “{awaitingApproval}” 단계에서 멈췄습니다. 승인하면 적용 단계까지
            계속합니다.
          </p>
          <Button
            size="xs"
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200"
            onClick={() => run({ requirements: goal, approvals: [awaitingApproval] })}
          >
            승인하고 계속
          </Button>
        </div>
      )}

      {phase === "completed" && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
          워크플로우 완료
        </div>
      )}
    </div>
  );
}
