export const dynamic = "force-dynamic";

import { listCustomers, listOpportunities, listPartners } from "@sangfor/business";

import { toDeal } from "@/components/deals/map-deal";
import { DealsWorkspace } from "@/components/deals/deals-workspace";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

export default async function DealsPage() {
  const [opportunities, customers, partners] = await Promise.all([
    listOpportunities(),
    listCustomers(),
    listPartners(),
  ]);
  const safe = serializeDecimalAtBoundary(opportunities);

  const deals = safe.map(toDeal);

  return (
    <DealsWorkspace
      deals={deals}
      customers={customers.map((customer) => ({ id: customer.id, label: customer.name }))}
      partners={partners.map((partner) => ({ id: partner.id, label: partner.name }))}
    />
  );
}
