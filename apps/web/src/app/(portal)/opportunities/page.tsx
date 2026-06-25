export const dynamic = "force-dynamic";

import { listCustomers, listOpportunities, listPartners } from "@ai-portal/automation";

import { CreateOpportunityForm } from "@/components/opportunities/create-opportunity-form";
import {
  OpportunityClosedList,
  OpportunityPipelineBoard,
} from "@/components/opportunities/pipeline-board";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

export default async function OpportunitiesPage() {
  const [opportunities, customers, partners] = await Promise.all([
    listOpportunities(),
    listCustomers(),
    listPartners(),
  ]);
  const safeOpportunities = serializeDecimalAtBoundary(opportunities);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">영업기회 관리</h1>
        <p className="text-muted-foreground">Sales pipeline by canonical stage.</p>
      </div>
      <CreateOpportunityForm
        customers={customers.map((c) => ({ id: c.id, label: c.name }))}
        partners={partners.map((p) => ({ id: p.id, label: p.name }))}
      />
      <OpportunityPipelineBoard opportunities={safeOpportunities} />
      <OpportunityClosedList opportunities={safeOpportunities} />
    </div>
  );
}
