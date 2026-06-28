/**
 * @sangfor/infra - MCP HTTP bridge client
 *
 * Thin client over the whelp99 MCP HTTP bridge (services/sangfor-engineer-mcp,
 * apps/http-bridge). The bridge wraps a stdio JSON-RPC MCP server with REST:
 *   GET  /tools           → { tools: [...] }
 *   POST /tools/call      { name, arguments? } → { result } | { error }
 *
 * The bridge enforces a read-only safe-tool whitelist by default
 * (WHELP99_ENFORCE_SAFE_TOOLS); whitelist violations come back as 403 { error }.
 */

import { getUrl } from '@sangfor/config';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallResult {
  result?: unknown;
  error?: string;
  /** Tools the bridge will allow when a call is rejected by the whitelist. */
  allowedTools?: string[];
}

export interface McpClientOptions {
  /** Override the bridge base URL. Defaults to env / port registry. */
  baseUrl?: string;
  /** Abort after this many ms (default 30000 — MCP tools can be slow). */
  timeoutMs?: number;
  /** Inject a fetch implementation (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

function bridgeBaseUrl(override?: string): string {
  return override ?? process.env.WHELP99_MCP_HTTP_URL ?? getUrl('WHELP99_MCP_BRIDGE');
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** List the MCP tools the bridge exposes. */
export async function listMcpTools(opts: McpClientOptions = {}): Promise<McpTool[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const { signal, clear } = withTimeout(opts.timeoutMs ?? 30_000);
  try {
    const res = await doFetch(`${bridgeBaseUrl(opts.baseUrl)}/tools`, { signal });
    const body = (await res.json()) as { tools?: McpTool[]; error?: string };
    if (!res.ok || body.error) {
      throw new Error(body.error ?? `MCP bridge /tools failed: HTTP ${res.status}`);
    }
    return body.tools ?? [];
  } finally {
    clear();
  }
}

/**
 * Call an MCP tool through the bridge. Returns the bridge envelope as-is:
 * { result } on success, or { error, allowedTools? } when the call is rejected
 * (e.g. not in the safe whitelist). Network/timeout failures throw.
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown> = {},
  opts: McpClientOptions = {},
): Promise<McpCallResult> {
  if (!name) throw new Error('callMcpTool: tool name is required');

  const doFetch = opts.fetchImpl ?? fetch;
  const { signal, clear } = withTimeout(opts.timeoutMs ?? 30_000);
  try {
    const res = await doFetch(`${bridgeBaseUrl(opts.baseUrl)}/tools/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
      signal,
    });
    return (await res.json()) as McpCallResult;
  } finally {
    clear();
  }
}
