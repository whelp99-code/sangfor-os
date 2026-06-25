export const dynamic = "force-dynamic";

import { RegistryPageView } from "@/components/registry/registry-page-view";

export default function BlocksPage() {
  return (
    <RegistryPageView
      pageKey="modules"
      title="Blocks"
      description="Block registry entries powering portal pages."
    />
  );
}
