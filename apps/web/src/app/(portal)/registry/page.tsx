export const dynamic = "force-dynamic";

import Link from "next/link";
import { RegistryAdminPanel } from "@/components/registry/registry-admin-panel";
import { RegistryPageView } from "@/components/registry/registry-page-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegistryPage() {
  return (
    <div className="space-y-8">
      <RegistryPageView
        pageKey="registry"
        title="레지스트리 관리"
        description="DB 기반 모듈, 블록, 쿼리, 레이아웃, 노드, 커넥터 및 카탈로그 레지스트리."
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="rounded-md border border-border shadow-sm">
          <CardHeader className="p-4 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span>상품 및 SKU 카탈로그 레지스트리</span>
              <Link
                href="/registry/products"
                className="text-xs font-mono text-primary hover:underline"
              >
                열기 &rarr;
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 text-xs text-muted-foreground">
            Product Family, Edition, License Metric, SKU 생애주기 관리 및 JSON 가져오기/가역 보존 표면.
          </CardContent>
        </Card>
      </div>
      <RegistryAdminPanel />
    </div>
  );
}
