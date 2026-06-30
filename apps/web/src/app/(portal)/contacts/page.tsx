export const dynamic = "force-dynamic";

import { listCustomers } from "@sangfor/business";

import { ContactsTable, type ContactRow } from "@/components/contacts/contacts-table";

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
      <ContactsTable contacts={contacts} />
    </div>
  );
}
