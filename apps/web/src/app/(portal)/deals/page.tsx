export const dynamic = "force-dynamic";

import { listCustomers, listOpportunities, listPartners } from "@sangfor/business";
import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";

import { toDeal } from "@/components/deals/map-deal";
import { DealsWorkspace } from "@/components/deals/deals-workspace";
import { formatKRWCompact } from "@/components/deals/stage-meta";
import { PageHeader } from "@/components/ui/page-header";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

export default async function DealsPage() {
  const [opportunities, customers, partners] = await Promise.all([
    listOpportunities(),
    listCustomers(),
    listPartners(),
  ]);
  const safe = serializeDecimalAtBoundary(opportunities);

  const deals = safe.map(toDeal);

  const openDeals = deals.filter((deal) => {
    const stage = normalizeOpportunityStage(deal.stage);
    return stage !== "WON" && stage !== "LOST";
  });
  const openValue = openDeals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="딜 파이프라인"
        description="진행 중인 영업기회를 단계별로 관리하고 다음 액션을 결정하세요. 카드를 끌어 단계를 이동할 수 있습니다."
        status={`진행 중 ${openDeals.length}건 · 파이프라인 ${formatKRWCompact(openValue)}`}
        updatedAt={new Date()}
      />
      <DealsWorkspace
        deals={deals}
        customers={customers.map((customer) => ({ id: customer.id, label: customer.name }))}
        partners={partners.map((partner) => ({ id: partner.id, label: partner.name }))}
      />
    </div>
  );
}
