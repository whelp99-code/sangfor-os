"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AutomationPreviewCards } from "@/components/automation/automation-preview-cards";
import { ContextPackSummaryCard } from "@/components/phase13/context-pack-summary-card";
import { actionErrorMessage } from "@/lib/action-error-labels";

type SkillRun = {
  id: string;
  skillKey: string;
  executionMode: string;
  status: string;
  normalizeError?: string | null;
};

type BreakdownItem = {
  id: string;
  title: string;
  description?: string | null;
  targetArea: string;
  agentType: string;
  riskLevel: string;
  estimatedHours: number;
};

type RunPerformance = {
  totalDurationMs?: number;
  llmCallCount?: number;
  templateCallCount?: number;
  executionProfile?: string;
  skillConcurrency?: number;
};

type PreviewResult = Parameters<typeof AutomationPreviewCards>[0]["result"];

export function OrchestratorPanel() {
  const [inputSummary, setInputSummary] = useState(
    "Add Phase 13 orchestrator with PM skills routing",
  );
  const [templateKey, setTemplateKey] = useState<string>("");
  const [includeContextPack, setIncludeContextPack] = useState<boolean>(true);
  const [skillKeys, setSkillKeys] = useState<string[]>([]);
  const [skillRuns, setSkillRuns] = useState<SkillRun[]>([]);
  const [breakdown, setBreakdown] = useState<BreakdownItem[]>([]);
  const [commandRunId, setCommandRunId] = useState<string | null>(null);
  const [contextPack, setContextPack] = useState<
    Parameters<typeof ContextPackSummaryCard>[0]["contextPack"]
  >(null);
  const [templateOutput, setTemplateOutput] = useState<
    Parameters<typeof ContextPackSummaryCard>[0]["templateOutput"]
  >(null);
  const [handoffContextSummary, setHandoffContextSummary] = useState<string | null>(
    null,
  );
  const [performance, setPerformance] = useState<RunPerformance | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRecommend() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/automation/skills/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputSummary, phase: 13 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "recommend_failed");
      setSkillKeys(data.skillKeys ?? []);
    } catch (err) {
      setError(actionErrorMessage(err instanceof Error ? err.message : "recommend_failed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/automation/phase13/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputSummary,
          phase: 13,
          templateKey: templateKey || undefined,
          includeContextPack,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "run_failed");
      setCommandRunId(data.commandRunId ?? null);
      setSkillKeys(data.skillKeys ?? []);
      setSkillRuns(data.skillRuns ?? []);
      setBreakdown(data.workBreakdownItems ?? []);
      setContextPack(data.contextPack ?? null);
      setTemplateOutput(data.templateOutput ?? null);
      setHandoffContextSummary(data.handoffDraft?.contextPackSummary ?? null);
      setPerformance(data.performance ?? null);
    } catch (err) {
      setError(actionErrorMessage(err instanceof Error ? err.message : "run_failed"));
    } finally {
      setLoading(false);
    }
  }

  async function handlePreviewPlan() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/automation/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: inputSummary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "preview_failed");
      setPreviewResult(data);
    } catch (err) {
      setError(actionErrorMessage(err instanceof Error ? err.message : "preview_failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>기능 요청</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="inputSummary">
              inputSummary
            </label>
            <Input
              id="inputSummary"
              value={inputSummary}
              onChange={(event) => setInputSummary(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="templateKey">
                템플릿 키
              </label>
              <select
                id="templateKey"
                value={templateKey}
                onChange={(event) => setTemplateKey(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">없음 (기본 결정론적)</option>
                <option value="proposal-prd">제안 PRD</option>
                <option value="poc-experiment-plan">PoC 실험 계획</option>
                <option value="dev-implementation-plan">개발 구현 계획</option>
                <option value="bugfix-improvement-plan">버그 수정 / 개선 계획</option>
                <option value="release-closeout-plan">릴리스 마무리 계획</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="includeContextPack"
                  checked={includeContextPack}
                  onChange={(event) => setIncludeContextPack(event.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                />
                <label className="text-sm font-medium" htmlFor="includeContextPack">
                  컨텍스트 팩 포함
                </label>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={loading} onClick={handleRecommend} type="button" variant="outline">
              스킬 추천
            </Button>
            <Button disabled={loading} onClick={handlePreviewPlan} type="button" variant="outline">
              계획 미리보기
            </Button>
            <Button disabled={loading} onClick={handleRun} type="button">
              Phase 13 파이프라인 실행
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {commandRunId ? (
            <p className="text-sm text-muted-foreground">커맨드 실행: {commandRunId}</p>
          ) : null}
          {performance ? (
            <p className="text-sm text-muted-foreground">
              실행 시간: {Math.round((performance.totalDurationMs ?? 0) / 1000)}s
              {" · "}
              llm={performance.llmCallCount ?? 0}
              {" · "}
              template={performance.templateCallCount ?? 0}
              {" · "}
              profile={performance.executionProfile ?? "full"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {previewResult ? <AutomationPreviewCards result={previewResult} /> : null}

      {contextPack ? (
        <ContextPackSummaryCard
          contextPack={contextPack}
          templateOutput={templateOutput ?? undefined}
          handoffContextSummary={handoffContextSummary}
        />
      ) : null}

      {skillKeys.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>추천 스킬</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {skillKeys.map((key) => (
              <Badge key={key} variant="secondary">
                {key}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {skillRuns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>스킬 실행 타임라인</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {skillRuns.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <span className="font-medium">{run.skillKey}</span>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{run.status}</Badge>
                  <Badge variant={run.executionMode === "template" ? "secondary" : "default"}>
                    {run.executionMode === "template"
                      ? "MOCK_PM_SKILL_EXECUTION"
                      : run.executionMode}
                  </Badge>
                </div>
                {run.normalizeError ? (
                  <p className="w-full text-xs text-muted-foreground">{run.normalizeError}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {breakdown.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>작업 분해</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">제목</th>
                  <th className="py-2 pr-4">영역</th>
                  <th className="py-2 pr-4">에이전트</th>
                  <th className="py-2 pr-4">위험도</th>
                  <th className="py-2">시간</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2 pr-4">{item.title}</td>
                    <td className="py-2 pr-4">{item.targetArea}</td>
                    <td className="py-2 pr-4">{item.agentType}</td>
                    <td className="py-2 pr-4">{item.riskLevel}</td>
                    <td className="py-2">{item.estimatedHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
