import { buildTimeline, getCommandRunDetail } from "@sangfor/business";
import { notFound } from "next/navigation";

import { RunWorkflowButton } from "@/components/commands/run-workflow-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function CommandDetailPage({ params }: PageProps) {
  const { id } = await params;
  const run = await getCommandRunDetail(id);
  if (!run) notFound();

  const timeline = buildTimeline(run);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{run.command.title}</h1>
          <p className="text-muted-foreground">{run.inputSummary}</p>
        </div>
        <div className="flex gap-2">
          <Badge>{run.status}</Badge>
          {run.risk ? <Badge variant="secondary">Risk: {run.risk.riskLevel}</Badge> : null}
        </div>
      </div>

      {run.status !== "completed" ? <RunWorkflowButton commandRunId={run.id} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Intent analysis</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {run.intent?.summary ?? "Pending"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Risk analysis</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {run.risk ? `${run.risk.riskLevel} risk` : "Pending"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Execution timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {timeline.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex justify-between gap-4">
              <span>{item.label}</span>
              <span className="text-muted-foreground">{item.status}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {run.codeChanges.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Code changes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {run.codeChanges.map((change) => (
              <div key={change.id}>
                <p>{change.summary}</p>
                <p className="text-muted-foreground">
                  {change.changedFiles.length} files · {change.buildRuns[0]?.status ?? "no build"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
