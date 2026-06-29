import { getCustomerDetail, listMailEvidenceForEntity } from "@sangfor/business";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateContactForm } from "@/components/customers/create-contact-form";
import { EntityEditSheet } from "@/components/common/entity-edit-sheet";
import { DeleteEntityButton } from "@/components/common/delete-entity-button";
import { MailEvidenceCard } from "@/components/mail-candidates/mail-evidence-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PageProps = { params: Promise<{ id: string }> };

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [customer, mailEvidence] = await Promise.all([
    getCustomerDetail(id),
    listMailEvidenceForEntity("customer", id),
  ]);
  if (!customer) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{customer.name}</h1>
        <p className="text-muted-foreground">{customer.domain ?? "No domain"} · {customer.industry ?? "—"}</p>
        <div className="flex items-center gap-2 mt-2">
          <EntityEditSheet
            title="고객 수정"
            endpoint={`/api/customers/${customer.id}`}
            fields={[
              { name: "name", label: "이름" },
              { name: "domain", label: "도메인" },
              { name: "industry", label: "업종" },
              { name: "notes", label: "메모" },
            ]}
            initial={{ name: customer.name, domain: customer.domain ?? "", industry: customer.industry ?? "", notes: customer.notes ?? "" }}
          />
          <DeleteEntityButton endpoint={`/api/customers/${customer.id}`} redirectTo="/customers" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Partners</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {customer.partnerLinks.map((l) => (
              <div key={l.id}>{l.partner.name} <Badge variant="outline">{l.linkType}</Badge></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <CreateContactForm customerId={customer.id} />
            {customer.contacts.map((c) => (
              <div key={c.id}>{c.name} · {c.email ?? "—"}</div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>PoC projects</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {customer.pocProjects.length === 0 ? (
              <p className="text-muted-foreground">No PoC projects linked.</p>
            ) : (
              customer.pocProjects.map((p) => (
                <div key={p.id} className="flex justify-between gap-2">
                  <Link href={`/poc/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                  <Badge variant="outline">{p.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Opportunities</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {customer.opportunities.length === 0 ? (
              <p className="text-muted-foreground">No opportunities linked.</p>
            ) : (
              customer.opportunities.map((o) => (
                <div key={o.id} className="flex justify-between gap-2">
                  <Link href={`/opportunities/${o.id}`} className="font-medium hover:underline">{o.title}</Link>
                  <Badge>{o.stage}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      <MailEvidenceCard evidence={mailEvidence} />
      <Card>
        <CardHeader><CardTitle>Activity timeline</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {customer.activityLogs.map((log) => (
            <div key={log.id} className="flex justify-between gap-4">
              <span>{log.summary}</span>
              <Badge variant="secondary">{log.activityType}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Linked work tasks</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {customer.workTasks.length === 0 ? (
            <p className="text-muted-foreground">No linked tasks yet.</p>
          ) : (
            customer.workTasks.map((task) => (
              <div key={task.id} className="flex justify-between gap-2">
                <span>{task.title}</span>
                <Badge variant="outline">{task.status}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
