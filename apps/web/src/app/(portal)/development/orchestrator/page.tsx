export const dynamic = "force-dynamic";

import { RegistryPageView } from "@/components/registry/registry-page-view";
import { OrchestratorPanel } from "@/components/development/orchestrator-panel";

export default function DevelopmentOrchestratorPage() {
  return (
    <div className="space-y-6">
      <RegistryPageView
        pageKey="development.orchestrator"
        title="Phase 13 Orchestrator"
        description="PM Skills routing, skill runs, and work breakdown for development requests."
      />
      <OrchestratorPanel />
    </div>
  );
}
