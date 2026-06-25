"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ContextPackSection = {
  key: string;
  title: string;
  empty: boolean;
  content: string;
};

export type ContextPackSummary = {
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  templateKey?: string | null;
  summaryText: string;
  sections: ContextPackSection[];
};

type TemplateOutput = {
  templateKey: string;
  title: string;
  bodyMarkdown: string;
  deterministic: boolean;
};

export function ContextPackSummaryCard({
  contextPack,
  templateOutput,
  handoffContextSummary,
}: {
  contextPack?: ContextPackSummary | null;
  templateOutput?: TemplateOutput | null;
  handoffContextSummary?: string | null;
}) {
  if (!contextPack && !templateOutput && !handoffContextSummary) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Context pack</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {contextPack?.templateKey ? (
          <Badge variant="outline">Template: {contextPack.templateKey}</Badge>
        ) : null}
        {contextPack?.summaryText ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
            {contextPack.summaryText}
          </pre>
        ) : null}
        {contextPack?.sections && contextPack.sections.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {contextPack.sections.map((section) => (
              <Badge
                key={section.key}
                variant={section.empty ? "secondary" : "default"}
              >
                {section.title}
                {section.empty ? " (empty)" : ""}
              </Badge>
            ))}
          </div>
        ) : null}
        {templateOutput ? (
          <div className="space-y-1">
            <p className="font-medium">{templateOutput.title}</p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs">
              {templateOutput.bodyMarkdown.slice(0, 600)}
              {templateOutput.bodyMarkdown.length > 600 ? "\n…" : ""}
            </pre>
          </div>
        ) : null}
        {handoffContextSummary ? (
          <p className="text-xs text-muted-foreground">
            Included in handoff draft (context pack summary).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
