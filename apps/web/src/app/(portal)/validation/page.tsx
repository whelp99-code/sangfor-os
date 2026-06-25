export const dynamic = "force-dynamic";

import { getObservabilitySummary } from "@sangfor/business";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ValidationPage() {
  const summary = await getObservabilitySummary();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Validation & Observability</h1>
        <p className="text-muted-foreground">
          Quality gates, LLM usage, and cost tracking for automation runs.
        </p>
      </div>
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
    </div>
  );
}
