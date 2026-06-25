import { getCustomerDetail } from "@ai-portal/automation";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateContactForm } from "@/components/customers/create-contact-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PageProps = { params: Promise<{ id: string }> };

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const customer = await getCustomerDetail(id);
  if (!customer) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{customer.name}</h1>
        <p className="text-muted-foreground">{customer.domain ?? "No domain"} · {customer.industry ?? "—"}</p>
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
