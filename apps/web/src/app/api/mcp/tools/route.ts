import { NextResponse } from "next/server";
import { callMcpTool, listMcpTools } from "@sangfor/infra";
import { z } from "zod";

import {
  apiError,
  authorizeOperatorRequest,
  findCallerIdentityConflicts,
  stripCallerIdentityFields,
} from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const toolArgumentsSchema = z.object({}).catchall(z.unknown());

/** GET /api/mcp/tools — list the MCP tools exposed by the whelp99 bridge. */
export function GET(): Promise<NextResponse>;
export function GET(request: Request): Promise<NextResponse>;
export async function GET(request?: Request) {
  const authorization = authorizeOperatorRequest(
    request ?? new Request("http://localhost/api/mcp/tools"),
  );
  if (authorization instanceof NextResponse) return authorization;
  try {
    const tools = await listMcpTools();
    return NextResponse.json({ tools, timestamp: new Date().toISOString() });
  } catch (error) { // no-excuse-ok: catch
    return apiError("mcp_tools_unreachable", error, {
      status: 502,
      extra: { tools: [] },
    });
  }
}

/**
 * POST /api/mcp/tools — invoke an MCP tool through the bridge.
 * Body: { name: string, arguments?: Record<string, unknown> }
 * The bridge enforces a read-only safe-tool whitelist; rejections come back
 * as { error, allowedTools } with a 403-equivalent envelope.
 */
export async function POST(request: Request) {
  const authorization = authorizeOperatorRequest(request);
  if (authorization instanceof NextResponse) return authorization;
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
  const parsedArgs = toolArgumentsSchema.safeParse(rawArgs);
  const args = parsedArgs.success ? parsedArgs.data : {};
  if (findCallerIdentityConflicts(args, authorization.principalId).length > 0) {
    return NextResponse.json({ error: "IDENTITY_CONFLICT" }, { status: 400 });
  }

  try {
    const result = await callMcpTool(name, stripCallerIdentityFields(args));
    return NextResponse.json(result, { status: result.error ? 502 : 200 });
  } catch (error) { // no-excuse-ok: catch
    return apiError("mcp_call_failed", error, { status: 500 });
  }
}
