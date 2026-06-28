import { NextResponse } from "next/server";
import { callMcpTool, listMcpTools } from "@sangfor/infra";

export const dynamic = "force-dynamic";

/** GET /api/mcp/tools — list the MCP tools exposed by the whelp99 bridge. */
export async function GET() {
  try {
    const tools = await listMcpTools();
    return NextResponse.json({ tools, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      {
        tools: [],
        error: error instanceof Error ? error.message : "mcp_tools_unreachable",
      },
      { status: 502 },
    );
  }
}

/**
 * POST /api/mcp/tools — invoke an MCP tool through the bridge.
 * Body: { name: string, arguments?: Record<string, unknown> }
 * The bridge enforces a read-only safe-tool whitelist; rejections come back
 * as { error, allowedTools } with a 403-equivalent envelope.
 */
export async function POST(request: Request) {
  let body: { name?: unknown; arguments?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const rawArgs = body.arguments ?? body.args ?? {};
  const args =
    rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};

  try {
    const result = await callMcpTool(name, args);
    return NextResponse.json(result, { status: result.error ? 502 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "mcp_call_failed" },
      { status: 500 },
    );
  }
}
