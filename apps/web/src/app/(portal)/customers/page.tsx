export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { listCustomers } from "@sangfor/business";
import Link from "next/link";

import { CreateCustomerForm } from "@/components/customers/create-customer-form";
import { CustomerSearchForm } from "@/components/customers/customer-search-form";
import { CustomersDataTable } from "@/components/customers/customers-data-table";
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
      <Suspense fallback={null}>
        <CustomersDataTable customers={customers} searchQuery={q ?? null} />
      </Suspense>
    </div>
  );
}

