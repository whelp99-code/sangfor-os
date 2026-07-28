export const dynamic = "force-dynamic";

import { listCustomersWithOpportunities, resolveCrmAuthContext } from "@sangfor/business";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CompaniesWorkspace, type Company } from "@/components/companies/companies-workspace";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export default async function CustomersPage() {
  const token = (await cookies()).get("session")?.value;
  if (!token) redirect("/login");
  const session = await evaluatePersistedSessionFromRequest(
    new Request("http://sangfor.local/customers", {
      headers: { cookie: `session=${encodeURIComponent(token)}` },
    }),
  );
  if (!session.ok) redirect("/login");
  const ctx = await resolveCrmAuthContext({
    userId: session.userId,
    sessionId: null,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    product: "portal",
  });
  const page = await listCustomersWithOpportunities(ctx, { first: 100 });

  const companies: Company[] = page.items.map((customer) => ({
    id: customer.id,
    name: customer.name,
    domain: customer.domain ?? null,
    industry: customer.industry ?? null,
    status: customer.status,
    contacts: customer.contacts.length,
    partners: customer.partnerLinks.length,
    tasks: customer._count.workTasks,
    deals: customer.opportunities.map((opp) => ({
      id: opp.id,
      title: opp.title,
      code: opp.code ?? null,
      stage: opp.stage,
      amount: opp.amount != null ? Number(opp.amount) : null,
    })),
  }));

  return (
    <div className="space-y-4">
      <CompaniesWorkspace
        companies={companies}
        canWrite={ctx.permissions.includes("customer.write")}
      />
    </div>
  );
}
