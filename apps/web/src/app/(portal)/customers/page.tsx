export const dynamic = "force-dynamic";

import { listCustomers, getCustomerDetail } from "@sangfor/business";

import { CompaniesWorkspace, type Company } from "@/components/companies/companies-workspace";

export default async function CustomersPage() {
  const customers = await listCustomers("demo-project");

  // Enrich each customer with their opportunities for the detail panel.
  // Run in parallel; individual failures silently collapse to empty deals.
  const companies: Company[] = await Promise.all(
    customers.map(async (customer) => {
      let deals: Company["deals"] = [];
      try {
        const detail = await getCustomerDetail(customer.id);
        deals = (detail?.opportunities ?? []).map((opp) => ({
          id: opp.id,
          title: opp.title,
          code: opp.code ?? null,
          stage: opp.stage,
          amount: opp.amount != null ? Number(opp.amount) : null,
        }));
      } catch {
        // silently skip — detail unavailable
      }
      return {
        id: customer.id,
        name: customer.name,
        domain: customer.domain ?? null,
        industry: customer.industry ?? null,
        status: customer.status,
        contacts: customer.contacts.length,
        partners: customer.partnerLinks.length,
        tasks: customer._count.workTasks,
        deals,
      };
    })
  );

  return (
    <div className="space-y-4">
      <CompaniesWorkspace companies={companies} />
    </div>
  );
}
