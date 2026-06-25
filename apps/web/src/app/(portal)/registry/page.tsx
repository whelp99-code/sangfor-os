export const dynamic = "force-dynamic";

import { RegistryAdminPanel } from "@/components/registry/registry-admin-panel";
import { RegistryPageView } from "@/components/registry/registry-page-view";

export default function RegistryPage() {
  return (
    <div className="space-y-8">
      <RegistryPageView
        pageKey="registry"
        title="Registry Admin"
        description="DB-backed module, block, query, layout, node, and connector registry."
      />
      <RegistryAdminPanel />
    </div>
  );
}
