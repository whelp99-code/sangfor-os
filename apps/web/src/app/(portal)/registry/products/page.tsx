export const dynamic = "force-dynamic";

import { CatalogWorkspace } from "@/components/registry/products/catalog-workspace";

export default function RegistryProductsPage() {
  return (
    <div className="space-y-6">
      <CatalogWorkspace />
    </div>
  );
}
