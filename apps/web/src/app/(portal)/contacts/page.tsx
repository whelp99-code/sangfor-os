export const dynamic = "force-dynamic";

import { listCustomers } from "@sangfor/business";

import { ContactsTable, type ContactRow } from "@/components/contacts/contacts-table";
import { PageHeader } from "@/components/ui/page-header";

export default async function ContactsPage() {
  const customers = await listCustomers("demo-project");

  const contacts: ContactRow[] = customers.flatMap((customer) =>
    customer.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      company: customer.name,
      customerId: customer.id,
    }))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="연락처"
        description="모든 고객사 담당자를 한곳에서 검색하세요. 행을 클릭하면 소속 고객사로 이동합니다."
        status={`총 ${contacts.length}명`}
      />
      <ContactsTable contacts={contacts} />
    </div>
  );
}
