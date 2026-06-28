/**
 * @sangfor/infra — Engineer operator-console client
 *
 * Thin client over the engineer-mcp operator console (services/sangfor-engineer-mcp,
 * apps/operator-console, port WHELP99_OPERATOR_CONSOLE=3502). These are the
 * higher-level capabilities (analyze-project, generate-config-plan, rag-search)
 * used by cross-service autonomous workflows.
 */

import { getUrl } from "@sangfor/config";

export interface EngineerConsoleOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function consoleBaseUrl(override?: string): string {
  return override ?? process.env.WHELP99_OPERATOR_CONSOLE_URL ?? getUrl("WHELP99_OPERATOR_CONSOLE");
}

async function post<T = unknown>(
  path: string,
  body: unknown,
  opts: EngineerConsoleOptions = {},
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await doFetch(`${consoleBaseUrl(opts.baseUrl)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`engineer-console ${path} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const engineerConsole = {
  analyzeProject: (body: Record<string, unknown>, opts?: EngineerConsoleOptions) =>
    post("/api/analyze-project", body, opts),
  generateConfigPlan: (body: Record<string, unknown>, opts?: EngineerConsoleOptions) =>
    post("/api/generate-config-plan", body, opts),
  analyzeRequirements: (body: Record<string, unknown>, opts?: EngineerConsoleOptions) =>
    post("/api/analyze-requirements", body, opts),
  ragSearch: (body: Record<string, unknown>, opts?: EngineerConsoleOptions) =>
    post("/api/rag-search", body, opts),
};
