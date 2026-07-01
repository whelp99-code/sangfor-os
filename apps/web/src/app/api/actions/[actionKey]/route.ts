import { getActionDefinition } from "@sangfor/business/action-connector-runtime";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ actionKey: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { actionKey } = await context.params;
    const decodedKey = decodeURIComponent(actionKey);
    const action = getActionDefinition(decodedKey);
    if (!action) {
      return NextResponse.json({ error: "action_not_found" }, { status: 404 });
    }
    return NextResponse.json({
      action,
      links: {
        validate: `/api/actions/${encodeURIComponent(decodedKey)}/validate`,
        connectors: "/api/connectors",
      },
    });
  } catch (error) {
    return apiError("get_action_failed", error, { status: 500 });
  }
}
