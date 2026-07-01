import { enrichModuleWithActionConnectorMetadata } from "@sangfor/business/action-connector-runtime";
import { getModuleManifest } from "@sangfor/business/module-runtime";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

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
    return apiError("get_module_failed", error, { status: 500 });
  }
}
