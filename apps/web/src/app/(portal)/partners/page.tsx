export const dynamic = "force-dynamic";

import { listPartners } from "@ai-portal/automation";
import Link from "next/link";

import { CreatePartnerForm } from "@/components/customers/create-partner-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PartnersPage() {
  const partners = await listPartners();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">파트너 관리</h1>
        <p className="text-muted-foreground">Reseller and integration partners.</p>
      </div>
      <CreatePartnerForm />
      <div className="grid gap-3">
        {partners.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reseller or integration partners registered yet.</p>
        ) : (
          partners.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{p.name}</CardTitle>
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/partners/${p.id}`}>
                  Open
                </Link>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {p.partnerType ?? "partner"} · {p.customerLinks.length} customers
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
