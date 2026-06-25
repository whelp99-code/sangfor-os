import { enrichModuleWithActionConnectorMetadata } from "@ai-portal/automation/action-connector-runtime";
import { getModuleManifest } from "@ai-portal/automation/module-runtime";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ moduleKey: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { moduleKey } = await context.params;
    const moduleManifest = await getModuleManifest(moduleKey);
    if (!moduleManifest) {
      return NextResponse.json({ error: "module_not_found" }, { status: 404 });
    }
    const enrichedModule = await enrichModuleWithActionConnectorMetadata(moduleManifest);
    return NextResponse.json({
      module: enrichedModule,
      links: {
        actions: enrichedModule.links.actions,
        connectors: enrichedModule.links.connectors,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "get_module_failed" },
      { status: 500 },
    );
  }
}
