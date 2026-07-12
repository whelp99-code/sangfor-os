export const dynamic = "force-dynamic";

import { RegistryPageView } from "@/components/registry/registry-page-view";
import { OrchestratorPanel } from "@/components/development/orchestrator-panel";

export default function DevelopmentOrchestratorPage() {
  return (
    <div className="space-y-6">
      <RegistryPageView
        pageKey="development.orchestrator"
        title="Phase 13 오케스트레이터"
        description="개발 요청에 대한 PM 스킬 라우팅, 스킬 실행, 작업 분해."
      />
      <OrchestratorPanel />
    </div>
  );
}
