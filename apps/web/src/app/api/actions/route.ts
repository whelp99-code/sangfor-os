import { listActionDefinitions } from "@sangfor/business/action-connector-runtime";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-auth";

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
    return apiError("list_actions_failed", error, { status: 500 });
  }
}
