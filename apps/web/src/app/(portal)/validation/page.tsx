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
        <h1 className="text-2xl font-semibold tracking-tight">Validation & Observability</h1>
        <p className="text-muted-foreground">
          Quality gates, LLM usage, and cost tracking for automation runs.
        </p>
      </div>
      {!hasData ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <h2 className="text-lg font-semibold text-muted-foreground">No observability data yet</h2>
          <p className="text-sm text-muted-foreground/70 max-w-md">
            Validation metrics will appear here once automation workflows begin running and generating telemetry.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">LLM calls</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{summary.llmCalls}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Total cost (USD)</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              ${summary.totalCostUsd.toFixed(2)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Workflow failures</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{summary.workflowFailures}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
