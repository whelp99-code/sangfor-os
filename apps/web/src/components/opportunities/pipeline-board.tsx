import { CANONICAL_STAGES, normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { stageLabel } from "@/components/deals/stage-meta";

type OpportunityRow = {
  id: string;
  title: string;
  stage: string;
  probability: number;
  amount: { toString(): string } | null;
  customer?: { name: string } | null;
};

export function OpportunityPipelineBoard({ opportunities }: { opportunities: OpportunityRow[] }) {
  const columns = CANONICAL_STAGES.filter((s) => s !== "WON" && s !== "LOST");
  const byStage = new Map<string, OpportunityRow[]>();
  for (const stage of columns) byStage.set(stage, []);
  for (const opp of opportunities) {
    const stage = normalizeOpportunityStage(opp.stage);
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(opp);
  }

  const hasActive = columns.some((stage) => (byStage.get(stage) ?? []).length > 0);
  if (!hasActive) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">진행 중인 기회가 없습니다.</p>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/opportunities">
          기회 추가
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
      {columns.map((stage) => (
        <Card key={stage}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{stageLabel(stage)}</CardTitle>
            <Badge variant="outline">{(byStage.get(stage) ?? []).length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {(byStage.get(stage) ?? []).map((o) => (
              <Link
                key={o.id}
                href={`/opportunities/${o.id}`}
                className="block rounded-md border p-2 text-sm hover:bg-muted/50"
              >
                <div className="font-medium">{o.title}</div>
                <div className="text-muted-foreground">{o.customer?.name ?? "—"} · {o.probability}%</div>
              </Link>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function OpportunityClosedList({ opportunities }: { opportunities: OpportunityRow[] }) {
  const closed = opportunities.filter((o) => {
    const s = normalizeOpportunityStage(o.stage);
    return s === "WON" || s === "LOST";
  });
  if (closed.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">종료</h2>
      {closed.map((o) => (
        <Card key={o.id}>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-base">{o.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge>{stageLabel(normalizeOpportunityStage(o.stage))}</Badge>
              <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/opportunities/${o.id}`}>
                열기
              </Link>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
