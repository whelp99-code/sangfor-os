export const dynamic = "force-dynamic";

import { RegistryAdminPanel } from "@/components/registry/registry-admin-panel";
import { RegistryPageView } from "@/components/registry/registry-page-view";

export default function RegistryPage() {
  return (
    <div className="space-y-8">
      <RegistryPageView
        pageKey="registry"
        title="레지스트리 관리"
        description="DB 기반 모듈, 블록, 쿼리, 레이아웃, 노드, 커넥터 레지스트리."
      />
      <RegistryAdminPanel />
    </div>
  );
}
