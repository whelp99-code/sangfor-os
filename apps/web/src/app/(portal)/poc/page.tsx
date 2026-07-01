export const dynamic = "force-dynamic";

import { listCustomers, listPartners, listPocProjects } from "@sangfor/business";
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
        <h1 className="text-2xl font-semibold tracking-tight">PoC 프로젝트</h1>
        <p className="text-muted-foreground">Sangfor 개념검증(PoC) 라이프사이클 관리.</p>
      </div>
      <div id="create-poc">
        <CreatePocForm
          customers={customers.map((c) => ({ id: c.id, label: c.name }))}
          partners={partners.map((p) => ({ id: p.id, label: p.name }))}
        />
      </div>
      <div className="grid gap-3">
        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">아직 PoC 프로젝트가 없습니다.</p>
            <Link
              className={`mt-3 ${buttonVariants({ variant: "outline", size: "sm" })}`}
              href="#create-poc"
            >
              새 PoC 등록
            </Link>
          </div>
        ) : (
          projects.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{p.title}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{p.status}</Badge>
                  <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/poc/${p.id}`}>
                    열기
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {p.productName ?? "—"}
                {p.productLine ? ` · ${p.productLine}` : ""}
                {" · "}
                {p.customer?.name ?? "고객사 없음"}
                {" · "}
                {p._count.checklistItems}개 체크리스트 · {p._count.requirementRows}개 요구사항
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
