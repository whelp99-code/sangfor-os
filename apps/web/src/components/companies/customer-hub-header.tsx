import type { ReactNode } from "react";
import { Building2, Handshake, ListChecks, Mail, Phone, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type CustomerHubHeaderProps = {
  title: string;
  domain?: string | null;
  industry?: string | null;
  status?: string | null;
  contacts?: number;
  partners?: number;
  deals?: number;
  pocProjects?: number;
  tasks?: number;
  email?: string | null;
  phone?: string | null;
  actions?: ReactNode;
  className?: string;
};

function metricLabel(value: number | null | undefined) {
  return `${value ?? 0}`;
}

export function CustomerHubHeader({
  title,
  domain,
  industry,
  status,
  contacts,
  partners,
  deals,
  pocProjects,
  tasks,
  email,
  phone,
  actions,
  className,
}: CustomerHubHeaderProps) {
  return (
    <section className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                고객사 허브 · 계정 기록
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
                {status ? <Badge variant="outline">{status}</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {domain ?? "도메인 미등록"} · {industry ?? "산업 미분류"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            <span className="rounded-full border bg-muted px-3 py-1">Sangfor</span>
            <span className="text-muted-foreground">→</span>
            <span className="inline-flex items-center gap-1 rounded-full border bg-sky-50 px-3 py-1 text-sky-800 dark:bg-sky-950 dark:text-sky-200">
              <Handshake className="size-3" aria-hidden="true" />
              파트너 {metricLabel(partners)}
            </span>
            <span className="text-muted-foreground">→</span>
            <span className="rounded-full border bg-emerald-50 px-3 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              고객 계정
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              작업 {metricLabel(tasks)}
            </span>
          </div>
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      <dl className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <dt className="text-xs text-muted-foreground">연락처</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-semibold tabular-nums">
            <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {metricLabel(contacts)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">활성 딜</dt>
          <dd className="mt-1 font-semibold tabular-nums">{metricLabel(deals)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">PoC</dt>
          <dd className="mt-1 font-semibold tabular-nums">{metricLabel(pocProjects)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">대표 이메일</dt>
          <dd className="mt-1 inline-flex max-w-full items-center gap-1 truncate font-semibold">
            <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{email ?? "미등록"}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">대표 전화</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-semibold">
            <Phone className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {phone ?? "미등록"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

type CustomerHubSummaryProps = {
  companies: Array<{
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    status: string;
    contacts: number;
    partners: number;
    tasks: number;
  }>;
  className?: string;
};

export function CustomerHubSummary({ companies, className }: CustomerHubSummaryProps) {
  const active = companies.filter((company) => company.status !== "archived").length;
  const contacts = companies.reduce((sum, company) => sum + company.contacts, 0);
  const partners = companies.reduce((sum, company) => sum + company.partners, 0);
  const tasks = companies.reduce((sum, company) => sum + company.tasks, 0);
  const focusCompany =
    [...companies].sort(
      (a, b) => b.tasks + b.contacts + b.partners - (a.tasks + a.contacts + a.partners)
    )[0] ?? null;

  return (
    <section className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Customer Hub · Relationship Cockpit
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">고객 관계 허브</h2>
            <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
              {active}개 활성 계정
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              연락처 {contacts}명 · 파트너 연결 {partners}건
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            <span className="rounded-full border bg-muted px-3 py-1">회사</span>
            <span className="rounded-full border bg-sky-50 px-3 py-1 text-sky-800 dark:bg-sky-950 dark:text-sky-200">
              연락처
            </span>
            <span className="rounded-full border bg-emerald-50 px-3 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              총판·파트너
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              작업 {tasks}
            </span>
          </div>
        </div>

        <div className="grid min-w-[280px] grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">포커스 고객</dt>
            <dd className="mt-1 truncate font-semibold">{focusCompany?.name ?? "고객 없음"}</dd>
          </div>
          <div className="rounded-md border bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">후속 작업</dt>
            <dd className="mt-1 inline-flex items-center gap-1 font-semibold tabular-nums">
              <ListChecks className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {tasks}
            </dd>
          </div>
        </div>
      </div>
    </section>
  );
}
