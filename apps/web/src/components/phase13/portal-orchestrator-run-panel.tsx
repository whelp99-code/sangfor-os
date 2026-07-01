"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContextPackSummaryCard } from "@/components/phase13/context-pack-summary-card";
import { actionErrorMessage } from "@/lib/action-error-labels";

type SourceEntityType = "opportunity" | "proposal" | "poc";

type SkillRun = {
  id: string;
  skillKey: string;
  executionMode: string;
  status: string;
};

type BreakdownItem = {
  id: string;
  title: string;
  targetArea: string;
  agentType: string;
  riskLevel: string;
  estimatedHours: number;
  suggestedOwner?: string;
  suggestedAgent?: string;
  confidence?: number;
  reason?: string;
};

type HandoffDraft = {
  cursorInstruction: string;
  codexValidationInstruction: string;
  suggestedBranch: string;
  validationCommands: string[];
  guardrails: string[];
  sourceEntitySummary?: string;
  contextPackSummary?: string;
};

type ContextPack = {
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  templateKey?: string | null;
  summaryText: string;
  sections: Array<{ key: string; title: string; empty: boolean; content: string }>;
};

type TemplateOutput = {
  templateKey: string;
  title: string;
  bodyMarkdown: string;
  deterministic: boolean;
};

type RunResponse = {
  commandRunId?: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  skillKeys?: string[];
  skillRuns?: SkillRun[];
  workBreakdownItems?: BreakdownItem[];
  handoffDraft?: HandoffDraft;
  contextPack?: ContextPack | null;
  templateOutput?: TemplateOutput | null;
  performance?: {
    totalDurationMs?: number;
    llmCallCount?: number;
    templateCallCount?: number;
    executionProfile?: string;
    skillConcurrency?: number;
  };
  error?: string;
};

export type PortalOrchestratorRunPanelProps = {
  title: string;
  buttonLabel: string;
  inputSummary: string;
  sourceEntityType: SourceEntityType;
  sourceEntityId: string;
  module?: string;
  phase?: number;
};

function formatHandoffCopy(draft: HandoffDraft) {
  return [
    "# Cursor instruction",
    draft.cursorInstruction,
    "",
    "# Codex validation",
    draft.codexValidationInstruction,
    "",
    "# Suggested branch",
    draft.suggestedBranch,
    "",
    "# Validation commands",
    draft.validationCommands.map((c) => `- ${c}`).join("\n"),
    "",
    "# Guardrails",
    draft.guardrails.map((g) => `- ${g}`).join("\n"),
    "",
    "# Context pack",
    draft.contextPackSummary ?? "(none)",
  ].join("\n");
}

export function PortalOrchestratorRunPanel({
  title,
  buttonLabel,
  inputSummary,
  sourceEntityType,
  sourceEntityId,
  module,
  phase = 13,
}: PortalOrchestratorRunPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/automation/phase13/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputSummary,
          phase,
          module,
          sourceEntityType,
          sourceEntityId,
        }),
      });
      const data = (await res.json()) as RunResponse;
      if (!res.ok) throw new Error(data.error ?? "phase13_run_failed");
      setResult(data);
    } catch (err) {
      setError(actionErrorMessage(err instanceof Error ? err.message : "phase13_run_failed"));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyHandoff() {
    if (!result?.handoffDraft) return;
    const text = formatHandoffCopy(result.handoffDraft);
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
          {inputSummary}
        </p>
        <Button disabled={loading} onClick={handleRun} type="button">
          {loading ? "실행 중…" : buttonLabel}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {result?.commandRunId ? (
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">명령 실행:</span>{" "}
              <Link
                href="/development/orchestrator"
                className="text-primary hover:underline"
              >
                {result.commandRunId}
              </Link>
            </p>
            {result.sourceEntityType && result.sourceEntityId ? (
              <p className="text-muted-foreground">
                연결됨 {result.sourceEntityType} {result.sourceEntityId}
              </p>
            ) : null}
            {result.performance ? (
              <p className="text-xs text-muted-foreground">
                실행시간 {Math.round((result.performance.totalDurationMs ?? 0) / 1000)}s
                {" · "}
                llm={result.performance.llmCallCount ?? 0}
                {" · "}
                template={result.performance.templateCallCount ?? 0}
                {" · "}
                profile={result.performance.executionProfile ?? "full"}
              </p>
            ) : null}
            {result.skillKeys && result.skillKeys.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {result.skillKeys.map((key) => (
                  <Badge key={key} variant="secondary">
                    {key}
                  </Badge>
                ))}
              </div>
            ) : null}
            {result.workBreakdownItems && result.workBreakdownItems.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2">제목</th>
                      <th className="p-2">영역</th>
                      <th className="p-2">Agent</th>
                      <th className="p-2">제안</th>
                      <th className="p-2">담당</th>
                      <th className="p-2">위험도</th>
                      <th className="p-2">시간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.workBreakdownItems.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="p-2">{item.title}</td>
                        <td className="p-2">{item.targetArea}</td>
                        <td className="p-2">{item.agentType}</td>
                        <td className="p-2">
                          {item.suggestedAgent ? (
                            <span title={item.reason}>
                              {item.suggestedAgent}
                              {item.confidence != null
                                ? ` (${Math.round(item.confidence * 100)}%)`
                                : ""}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2">{item.suggestedOwner ?? "—"}</td>
                        <td className="p-2">{item.riskLevel}</td>
                        <td className="p-2">{item.estimatedHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {result.contextPack ? (
              <ContextPackSummaryCard
                contextPack={result.contextPack}
                templateOutput={result.templateOutput ?? undefined}
                handoffContextSummary={result.handoffDraft?.contextPackSummary}
              />
            ) : null}
            {result.handoffDraft ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Handoff 초안</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyHandoff}
                  >
                    {copied ? "복사됨" : "Handoff 복사"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  브랜치: {result.handoffDraft.suggestedBranch}
                </p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {formatHandoffCopy(result.handoffDraft)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
