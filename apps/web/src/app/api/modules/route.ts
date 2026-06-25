import { enrichModuleWithActionConnectorMetadata } from "@sangfor/business/action-connector-runtime";
import { listModuleManifests } from "@sangfor/business/module-runtime";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const manifests = await listModuleManifests();
    const modules = await Promise.all(
      manifests.map((manifest) => enrichModuleWithActionConnectorMetadata(manifest)),
    );
    return NextResponse.json({
      contractVersion: "2026-05-27",
      moduleCount: modules.length,
      modules,
      links: {
        actions: "/api/actions",
        connectors: "/api/connectors",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_modules_failed" },
      { status: 500 },
    );
  }
}
