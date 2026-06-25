import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type IntentAnalysis = {
  summary: string;
  requestType: string;
  targetAreas: string[];
  skillKeys: string[];
  signals: string[];
  modelRouting: {
    strategy: string;
    openaiConfigured: boolean;
    model: string;
  };
};

type PlanItem = {
  id: string;
  title: string;
  targetArea: string;
  suggestedAgent: string;
  riskLevel: string;
  validationCommands: string[];
};

type PreviewResult = {
  analysis: IntentAnalysis;
  plan: {
    title: string;
    items: PlanItem[];
  };
  risk: {
    riskLevel: string;
    approvalRequired: boolean;
    reasons: string[];
    guardrails: string[];
  };
  approvalSummary?: {
    headline: string;
    decisionReason: string;
    recommendedChecks: string[];
  };
  prDraft?: {
    title: string;
    body: string;
    labels: string[];
  };
  previewOnly: true;
};

function RiskBadge({ riskLevel }: { riskLevel: string }) {
  const variant =
    riskLevel === "high" ? "destructive" : riskLevel === "medium" ? "secondary" : "outline";
  return <Badge variant={variant}>{riskLevel}</Badge>;
}

export function AutomationPreviewCards({ result }: { result: PreviewResult }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Intent preview
            <Badge variant="outline">preview-only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{result.analysis.summary}</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{result.analysis.requestType}</Badge>
            {result.analysis.targetAreas.map((area) => (
              <Badge key={area} variant="outline">
                {area}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {result.analysis.skillKeys.map((skillKey) => (
              <Badge key={skillKey} variant="ghost">
                {skillKey}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {result.analysis.modelRouting.strategy} · model={result.analysis.modelRouting.model} · openai=
            {result.analysis.modelRouting.openaiConfigured ? "configured" : "unset"}
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Risk summary
            <RiskBadge riskLevel={result.risk.riskLevel} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Approval {result.risk.approvalRequired ? "recommended" : "not required"} for this
            preview.
          </p>
          <div className="space-y-1 text-sm">
            {result.risk.reasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card size="sm" className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Plan preview</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">Step</th>
                <th className="py-2 pr-4">Area</th>
                <th className="py-2 pr-4">Agent</th>
                <th className="py-2 pr-4">Risk</th>
                <th className="py-2">Validation</th>
              </tr>
            </thead>
            <tbody>
              {result.plan.items.map((item) => (
                <tr key={item.id} className="border-b align-top">
                  <td className="max-w-[280px] py-2 pr-4">{item.title}</td>
                  <td className="py-2 pr-4">{item.targetArea}</td>
                  <td className="py-2 pr-4">{item.suggestedAgent}</td>
                  <td className="py-2 pr-4">
                    <RiskBadge riskLevel={item.riskLevel} />
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {item.validationCommands.join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {result.approvalSummary ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Approval summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">{result.approvalSummary.headline}</p>
            <p className="text-sm text-muted-foreground">
              {result.approvalSummary.decisionReason}
            </p>
            <div className="space-y-1 text-sm">
              {result.approvalSummary.recommendedChecks.map((check) => (
                <p key={check}>{check}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result.prDraft ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>PR draft preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium">{result.prDraft.title}</p>
            <div className="flex flex-wrap gap-2">
              {result.prDraft.labels.map((label) => (
                <Badge key={label} variant="outline">
                  {label}
                </Badge>
              ))}
            </div>
            <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {result.prDraft.body}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
