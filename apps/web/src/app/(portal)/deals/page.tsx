export const dynamic = "force-dynamic";

import {
  listCustomers,
  listOpportunities,
  listPartners,
  resolveOpportunityAuthContext,
} from "@sangfor/business";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { toDeal } from "@/components/deals/map-deal";
import { DealsWorkspace } from "@/components/deals/deals-workspace";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export default async function DealsPage() {
  const token = (await cookies()).get("session")?.value;
  if (!token) redirect("/login");
  const session = await evaluatePersistedSessionFromRequest(
    new Request("http://sangfor.local/deals", {
      headers: { cookie: `session=${encodeURIComponent(token)}` },
    }),
  );
  if (!session.ok) redirect("/login");
  const ctx = await resolveOpportunityAuthContext({
    userId: session.userId,
    sessionId: null,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    product: "portal",
  });
  const canReadCustomers = ctx.permissions.includes("customer.read");
  const [opportunityPage, customerPage, partners] = await Promise.all([
    listOpportunities(ctx, { first: 50 }),
    canReadCustomers ? listCustomers(ctx, { first: 100 }) : Promise.resolve({ items: [], nextCursor: null }),
    canReadCustomers ? listPartners() : Promise.resolve([]),
  ]);
  const safe = serializeDecimalAtBoundary(opportunityPage.items);

  const deals = safe.map(toDeal);

  return (
    <DealsWorkspace
      deals={deals}
      customers={customerPage.items.map((customer) => ({ id: customer.id, label: customer.name }))}
      partners={partners.map((partner) => ({ id: partner.id, label: partner.name }))}
      nextCursor={opportunityPage.nextCursor}
      canWrite={ctx.permissions.includes("opportunity.write")}
    />
  );
}
