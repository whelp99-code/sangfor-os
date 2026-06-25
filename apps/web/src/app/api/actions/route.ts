import { listActionDefinitions } from "@sangfor/business/action-connector-runtime";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const moduleKey = searchParams.get("moduleKey") ?? undefined;
    const actions = listActionDefinitions(moduleKey ? { moduleKey } : undefined);
    return NextResponse.json({
      contractVersion: "2026-05-27",
      actionCount: actions.length,
      actions,
      links: {
        connectors: "/api/connectors",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_actions_failed" },
      { status: 500 },
    );
  }
}
