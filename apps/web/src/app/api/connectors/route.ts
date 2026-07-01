import { listConnectorRuntimeStates } from "@sangfor/business/action-connector-runtime";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

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
    return apiError("list_connectors_failed", error, { status: 500 });
  }
}
