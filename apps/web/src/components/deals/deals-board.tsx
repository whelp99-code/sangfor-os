import { CANONICAL_STAGES, normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";

import { KanbanBoard, type KanbanColumnDef } from "@/components/views/kanban-board";
import { DealCard } from "@/components/deals/deal-card";
import { STAGE_ACCENT, STAGE_LABELS, formatKRWCompact } from "@/components/deals/stage-meta";
import type { Deal } from "@/components/deals/types";

const ACTIVE_STAGES = CANONICAL_STAGES.filter((stage) => stage !== "WON" && stage !== "LOST");

type BoardItem = Deal & { columnId: string };

export function DealsBoard({
  deals,
  onMove,
}: {
  deals: Deal[];
  onMove: (id: string, toStage: string) => void;
}) {
  const columns: KanbanColumnDef[] = ACTIVE_STAGES.map((stage) => ({
    id: stage,
    title: STAGE_LABELS[stage] ?? stage,
    accent: STAGE_ACCENT[stage],
  }));

  const items: BoardItem[] = deals
    .map((deal) => ({ ...deal, columnId: normalizeOpportunityStage(deal.stage) }))
    .filter((deal) => ACTIVE_STAGES.includes(deal.columnId as (typeof ACTIVE_STAGES)[number]));

  return (
    <KanbanBoard<BoardItem>
      columns={columns}
      items={items}
      onMove={onMove}
      renderCard={(deal) => <DealCard deal={deal} />}
      columnSummary={(_columnId, columnItems) => {
        const total = columnItems.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
        return `${columnItems.length}건 · ${formatKRWCompact(total)}`;
      }}
    />
  );
}
