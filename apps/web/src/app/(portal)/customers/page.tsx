export const dynamic = "force-dynamic";

import { listCustomers } from "@sangfor/business";

import { CompaniesWorkspace, type Company } from "@/components/companies/companies-workspace";
import { PageHeader } from "@/components/ui/page-header";

export default async function CustomersPage() {
  const customers = await listCustomers("demo-project");

  const companies: Company[] = customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    domain: customer.domain ?? null,
    industry: customer.industry ?? null,
    status: customer.status,
    contacts: customer.contacts.length,
    partners: customer.partnerLinks.length,
    tasks: customer._count.workTasks,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="고객사"
        description="고객 계정과 연락처·딜·작업을 한곳에서 관리하세요. 행을 클릭하면 상세로 이동합니다."
        status={`총 ${companies.length}개 고객사`}
      />
      <CompaniesWorkspace companies={companies} />
    </div>
  );
}
