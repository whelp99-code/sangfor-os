export const dynamic = "force-dynamic";

import { listCustomers, resolveCrmAuthContext } from "@sangfor/business";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ContactsTable, type ContactRow } from "@/components/contacts/contacts-table";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export default async function ContactsPage() {
  const token = (await cookies()).get("session")?.value;
  if (!token) redirect("/login");
  const session = await evaluatePersistedSessionFromRequest(new Request(
    "http://sangfor.local/contacts",
    { headers: { cookie: `session=${encodeURIComponent(token)}` } },
  ));
  if (!session.ok) redirect("/login");
  const ctx = await resolveCrmAuthContext({
    userId: session.userId,
    sessionId: null,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    product: "portal",
  });
  const customers = (await listCustomers(ctx, { first: 100 })).items;

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
