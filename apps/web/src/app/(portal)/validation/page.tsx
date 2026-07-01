export const dynamic = "force-dynamic";

import { getObservabilitySummary } from "@sangfor/business";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { BarChart3 } from "lucide-react";

export default async function ValidationPage() {
  const summary = await getObservabilitySummary();
  const hasData = summary && (summary.llmCalls > 0 || summary.totalCostUsd > 0 || summary.workflowFailures > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">검증 및 관측성</h1>
        <p className="text-muted-foreground">
          자동화 실행에 대한 품질 게이트, LLM 사용량, 비용 추적.
        </p>
      </div>
      {!hasData ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <h2 className="text-lg font-semibold text-muted-foreground">아직 관측성 데이터가 없습니다</h2>
          <p className="text-sm text-muted-foreground/70 max-w-md">
            자동화 워크플로가 실행되며 텔레메트리를 생성하면 검증 지표가 여기에 표시됩니다.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">LLM 호출</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{summary.llmCalls}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">총 비용 (USD)</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              ${summary.totalCostUsd.toFixed(2)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">워크플로 실패</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{summary.workflowFailures}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
