import { validateAction } from "@ai-portal/automation/action-connector-runtime";
import { prisma } from "@ai-portal/db";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ actionKey: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { actionKey } = await context.params;
    const decodedKey = decodeURIComponent(actionKey);

    let registryStatusByConnector: Record<string, string | null> = {};
    try {
      const rows = await prisma.connectorRegistry.findMany({
        select: { connectorKey: true, status: true },
      });
      registryStatusByConnector = Object.fromEntries(
        rows.map((row) => [row.connectorKey, row.status]),
      );
    } catch {
      registryStatusByConnector = {};
    }

    const validation = validateAction(decodedKey, { registryStatusByConnector });
    if (validation.errors.includes("action_not_found")) {
      return NextResponse.json(validation, { status: 404 });
    }
    const status = validation.valid ? 200 : 400;
    return NextResponse.json(validation, { status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "validate_action_failed" },
      { status: 500 },
    );
  }
}
