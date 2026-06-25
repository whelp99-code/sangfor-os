export const dynamic = "force-dynamic";

import { getModulesData } from "./actions";
import { ModuleDashboardClient } from "@/components/modules/module-dashboard-client";

export default async function ModulesPage() {
  const data = await getModulesData();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Module & Block Center</h1>
        <p className="text-xs text-muted-foreground">
          Monitor and configure registered runtime modules, blocks, nodes, and connectors.
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
