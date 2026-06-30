import { FileText, Package } from "lucide-react";

import { stageDisplay } from "@/components/deals/stage-meta";
import {
  ProposalWorkPanel,
  type GeneratedDocumentSummary,
} from "@/components/deals/work-panels/proposal-work-panel";
import {
  PocWorkPanel,
  type PocProjectSummary,
} from "@/components/deals/work-panels/poc-work-panel";
import {
  ResultsWorkPanel,
  type PocProjectWithResults,
} from "@/components/deals/work-panels/results-work-panel";
import {
  BidWorkPanel,
  type QuoteSummary,
} from "@/components/deals/work-panels/bid-work-panel";
import {
  WinWorkPanel,
  type EngagementSummary,
} from "@/components/deals/work-panels/win-work-panel";
import { Card, CardContent } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Minimal opportunity shape for the work tab (server-safe — no Prisma types).
// ---------------------------------------------------------------------------
export type OpportunityForWorkTab = {
  id: string;
  title: string;
  stage: string;
};

type DealWorkTabProps = {
  opportunity: OpportunityForWorkTab;
  proposals: GeneratedDocumentSummary[];
  /** PoC projects linked to this opportunity (filtered by opportunityId). */
  pocProjects: PocProjectSummary[];
  /** PoC projects with result reports, for stage ③. */
  pocProjectsWithResults: PocProjectWithResults[];
  /** Stage ④ data: quotes, SPR status, distributor name, competitor names. */
  bid: {
    quotes: QuoteSummary[];
    sprStatus: string | null;
    distributorName: string | null;
    competitors: string[];
  };
  /** Stage ⑤ data: existing engagement, deal amount, distributor name. */
  win: {
    engagement: EngagementSummary | null;
    amount: string | null;
    distributorName: string | null;
  };
};

// ---------------------------------------------------------------------------
// Placeholder stage card (stages 4–6; filled in Tasks 5.3–5.5)
// ---------------------------------------------------------------------------
type PlaceholderStageCardProps = {
  label: string;
  icon: React.ReactNode;
};

function PlaceholderStageCard({ label, icon }: PlaceholderStageCardProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <p className="font-bold text-sm">{label} 작업</p>
          <p className="mt-1 text-xs text-muted-foreground">
            이 단계 작업은 다음 단계에서 연결됩니다
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">준비</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-stage panel map (stages 4–6 as labeled placeholders)
// ---------------------------------------------------------------------------
const PLACEHOLDER_STAGES: Record<
  number,
  { label: string; icon: React.ReactNode }
> = {
  6: { label: "⑥ 딜리버리", icon: <Package className="size-5" aria-hidden="true" /> },
};

// ---------------------------------------------------------------------------
// DealWorkTab — per-stage work-surface router
// ---------------------------------------------------------------------------

/**
 * Routes the 작업 tab to the correct work panel based on the current
 * display stage index derived from `stageDisplay(opportunity.stage).idx`.
 *
 *  idx 1 → ProposalWorkPanel (stage ① 제안)
 *  idx 2 → PocWorkPanel (stage ② PoC)
 *  idx 3 → ResultsWorkPanel (stage ③ 결과제출)
 *  idx 4–6 → labeled placeholder card (Tasks 5.3–5.5 will fill these in)
 */
export function DealWorkTab({
  opportunity,
  proposals,
  pocProjects,
  pocProjectsWithResults,
  bid,
  win,
}: DealWorkTabProps) {
  const { idx } = stageDisplay(opportunity.stage);

  if (idx === 1) {
    return (
      <ProposalWorkPanel
        opportunityId={opportunity.id}
        opportunityTitle={opportunity.title}
        proposals={proposals}
      />
    );
  }

  if (idx === 2) {
    return <PocWorkPanel pocProjects={pocProjects} />;
  }

  if (idx === 3) {
    return <ResultsWorkPanel pocProjects={pocProjectsWithResults} />;
  }

  if (idx === 4) {
    return (
      <BidWorkPanel
        opportunityId={opportunity.id}
        quotes={bid.quotes}
        sprStatus={bid.sprStatus}
        distributorName={bid.distributorName}
        competitors={bid.competitors}
      />
    );
  }

  if (idx === 5) {
    return (
      <WinWorkPanel
        opportunityId={opportunity.id}
        engagement={win.engagement}
        amount={win.amount}
        distributorName={win.distributorName}
      />
    );
  }

  const placeholder = PLACEHOLDER_STAGES[idx];
  if (placeholder) {
    return (
      <PlaceholderStageCard
        label={placeholder.label}
        icon={placeholder.icon}
      />
    );
  }

  // Fallback for any unmapped idx
  return (
    <PlaceholderStageCard
      label={`단계 ${idx}`}
      icon={<FileText className="size-5" aria-hidden="true" />}
    />
  );
}
