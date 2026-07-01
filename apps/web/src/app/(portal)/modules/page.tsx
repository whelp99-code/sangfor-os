export const dynamic = "force-dynamic";

import { getModulesData } from "./actions";
import { ModuleDashboardClient } from "@/components/modules/module-dashboard-client";

export default async function ModulesPage() {
  const data = await getModulesData();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">모듈 &amp; 블록 센터</h1>
        <p className="text-xs text-muted-foreground">
          등록된 런타임 모듈, 블록, 노드, 커넥터를 모니터링하고 구성합니다.
        </p>
      </div>

      <ModuleDashboardClient
        initialModules={data.modules}
        initialBlocks={data.blocks}
        initialLayoutSlots={data.layoutSlots}
        initialNodes={data.nodes}
        initialConnectors={data.connectors}
        initialSkills={data.skills}
        configuredMap={data.configuredMap}
        recentTraceId={data.recentTraceId}
      />
    </div>
  );
}
