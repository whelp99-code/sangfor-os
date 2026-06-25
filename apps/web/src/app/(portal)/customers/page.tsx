export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { listCustomers } from "@ai-portal/automation";
import Link from "next/link";

import { CreateCustomerForm } from "@/components/customers/create-customer-form";
import { CustomerSearchForm } from "@/components/customers/customer-search-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function CustomersPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const customers = await listCustomers("demo-project", q);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">고객사 관리</h1>
        <p className="text-muted-foreground">고객사 계정과 연결된 파트너를 관리합니다.</p>
      </div>
      <Suspense fallback={null}>
        <CustomerSearchForm />
      </Suspense>
      <CreateCustomerForm />
      {q ? (
        <p className="text-sm text-muted-foreground">
          {customers.length} result(s) for &quot;{q}&quot;
        </p>
      ) : null}
      <div className="grid gap-3">
        {customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No customers yet.</p>
        ) : (
          customers.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{c.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{c.status}</Badge>
                  <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/customers/${c.id}`}>
                    Open
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {c.domain ?? "—"} · {c.partnerLinks.length} partners · {c._count.workTasks} tasks
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

