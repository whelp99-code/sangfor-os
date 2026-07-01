export const dynamic = "force-dynamic";

import { listCustomersWithOpportunities } from "@sangfor/business";

import { CompaniesWorkspace, type Company } from "@/components/companies/companies-workspace";

export default async function CustomersPage() {
  // Single query: customers + their opportunities (was N+1 — listCustomers then
  // per-customer getCustomerDetail with 6 relations of which only opportunities was used).
  const customers = await listCustomersWithOpportunities("demo-project");

  const companies: Company[] = customers.map((customer) => ({
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
      <CompaniesWorkspace companies={companies} />
    </div>
  );
}
