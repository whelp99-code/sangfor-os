import { getCustomerDetail, listMailEvidenceForEntity } from "@sangfor/business";
import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CreateContactForm } from "@/components/customers/create-contact-form";
import { CustomerHubHeader } from "@/components/companies/customer-hub-header";
import { EntityEditSheet } from "@/components/common/entity-edit-sheet";
import { DeleteEntityButton } from "@/components/common/delete-entity-button";
import { MailEvidenceCard } from "@/components/mail-candidates/mail-evidence-card";
import { stageLabel } from "@/components/deals/stage-meta";
import { RecordLayout } from "@/components/views/record-layout";
import { EmptyState } from "@/components/ui/states";
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

  const primaryContact = customer.contacts[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/customers"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> 고객사
        </Link>
        <div className="flex items-center gap-2">
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

      <CustomerHubHeader
        title={customer.name}
        domain={customer.domain}
        industry={customer.industry}
        status={customer.status}
        contacts={customer.contacts.length}
        partners={customer.partnerLinks.length}
        deals={customer.opportunities.length}
        pocProjects={customer.pocProjects.length}
        tasks={customer.workTasks.length}
        email={primaryContact?.email ?? null}
        phone={primaryContact?.phone ?? null}
      />

      <RecordLayout
        main={
          <>
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">딜</CardTitle>
                <Badge variant="secondary">{customer.opportunities.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {customer.opportunities.length === 0 ? (
                  <EmptyState
                    inline
                    title="연결된 딜이 없습니다"
                    description="영업기회에서 이 고객을 연결하면 표시됩니다."
                  />
                ) : (
                  customer.opportunities.map((deal) => (
                    <Link
                      key={deal.id}
                      href={`/opportunities/${deal.id}`}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-smooth hover:bg-muted/60"
                    >
                      <span className="font-medium">{deal.title}</span>
                      <Badge variant="outline">{stageLabel(normalizeOpportunityStage(deal.stage))}</Badge>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">PoC</CardTitle>
                <Badge variant="secondary">{customer.pocProjects.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {customer.pocProjects.length === 0 ? (
                  <EmptyState inline title="진행 중인 PoC가 없습니다" />
                ) : (
                  customer.pocProjects.map((poc) => (
                    <Link
                      key={poc.id}
                      href={`/poc/${poc.id}`}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-smooth hover:bg-muted/60"
                    >
                      <span className="font-medium">{poc.title}</span>
                      <Badge variant="outline">{poc.status}</Badge>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">연결된 작업</CardTitle>
                <Badge variant="secondary">{customer.workTasks.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {customer.workTasks.length === 0 ? (
                  <EmptyState inline title="연결된 작업이 없습니다" />
                ) : (
                  customer.workTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
                    >
                      <span>{task.title}</span>
                      <Badge variant="outline">{task.status}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <MailEvidenceCard evidence={mailEvidence} />
          </>
        }
        aside={
          <>
            <Card id="contacts" className="scroll-mt-20">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">연락처</CardTitle>
                <Badge variant="secondary">{customer.contacts.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <CreateContactForm customerId={customer.id} />
                {customer.contacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">등록된 연락처가 없습니다.</p>
                ) : (
                  customer.contacts.map((contact) => (
                    <div key={contact.id} className="rounded-md border px-2.5 py-1.5">
                      <p className="font-medium">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">{contact.email ?? "이메일 미등록"}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">파트너</CardTitle>
                <Badge variant="secondary">{customer.partnerLinks.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {customer.partnerLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">연결된 파트너가 없습니다.</p>
                ) : (
                  customer.partnerLinks.map((link) => (
                    <div key={link.id} className="flex items-center justify-between gap-2">
                      <span>{link.partner.name}</span>
                      <Badge variant="outline">{link.linkType}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">활동 타임라인</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {customer.activityLogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">기록된 활동이 없습니다.</p>
                ) : (
                  customer.activityLogs.map((log) => (
                    <div key={log.id} className="flex items-start justify-between gap-2 border-l-2 border-border pl-2.5">
                      <span className="text-muted-foreground">{log.summary}</span>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {log.activityType}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        }
      />
    </div>
  );
}
