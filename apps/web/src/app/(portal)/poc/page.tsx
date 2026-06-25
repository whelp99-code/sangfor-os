export const dynamic = "force-dynamic";

import { listCustomers, listPartners, listPocProjects } from "@ai-portal/automation";
import Link from "next/link";

import { CreatePocForm } from "@/components/poc/create-poc-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function PocPage() {
  const [projects, customers, partners] = await Promise.all([
    listPocProjects(),
    listCustomers(),
    listPartners(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">PoC Projects</h1>
        <p className="text-muted-foreground">Sangfor proof-of-concept lifecycle management.</p>
      </div>
      <CreatePocForm
        customers={customers.map((c) => ({ id: c.id, label: c.name }))}
        partners={partners.map((p) => ({ id: p.id, label: p.name }))}
      />
      <div className="grid gap-3">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PoC projects yet.</p>
        ) : (
          projects.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{p.title}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{p.status}</Badge>
                  <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/poc/${p.id}`}>
                    Open
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {p.productName ?? "—"}
                {p.productLine ? ` · ${p.productLine}` : ""}
                {" · "}
                {p.customer?.name ?? "No customer"}
                {" · "}
                {p._count.checklistItems} checklist · {p._count.requirementRows} requirements
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
