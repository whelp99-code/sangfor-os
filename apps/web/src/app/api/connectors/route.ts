import { listConnectorRuntimeStates } from "@sangfor/business/action-connector-runtime";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const connectors = await listConnectorRuntimeStates();
    return NextResponse.json({
      contractVersion: "2026-05-27",
      connectorCount: connectors.length,
      connectors,
      links: {
        actions: "/api/actions",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_connectors_failed" },
      { status: 500 },
    );
  }
}
