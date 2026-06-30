import { FileText, FlaskConical, ClipboardList, Trophy, Package } from "lucide-react";

import { stageDisplay } from "@/components/deals/stage-meta";
import {
  ProposalWorkPanel,
  type GeneratedDocumentSummary,
} from "@/components/deals/work-panels/proposal-work-panel";
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
};

// ---------------------------------------------------------------------------
// Placeholder stage card (stages 2–6; filled in Tasks 5.2–5.5)
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
// Per-stage panel map (stages 2–6 as labeled placeholders)
// ---------------------------------------------------------------------------
const PLACEHOLDER_STAGES: Record<
  number,
  { label: string; icon: React.ReactNode }
> = {
  2: { label: "② PoC", icon: <FlaskConical className="size-5" aria-hidden="true" /> },
  3: { label: "③ 결과제출", icon: <ClipboardList className="size-5" aria-hidden="true" /> },
  4: { label: "④ 선정·입찰", icon: <Trophy className="size-5" aria-hidden="true" /> },
  5: { label: "⑤ 수주", icon: <FileText className="size-5" aria-hidden="true" /> },
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
 *  idx 2–6 → labeled placeholder card (Tasks 5.2–5.5 will fill these in)
 */
export function DealWorkTab({ opportunity, proposals }: DealWorkTabProps) {
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
